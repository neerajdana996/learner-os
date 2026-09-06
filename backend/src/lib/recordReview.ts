import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { cards, items, reviewEvents } from '../db/schema.js';
import { fromDbCard, newCard, predictedRecall, Rating, scheduleReview, toDbCard } from '../scheduler/index.js';
import { ItemPayloadSchema, type Answer, type Surface } from '@learnos/shared';
import { grade } from './grade.js';

/** Surfaces that record the answer but must never move the card's schedule:
 *  the diagnostic measures prior knowledge (T-015) and the Day-30/45 tests
 *  measure retention (T-038) — scheduling on either would contaminate both. */
const NON_SCHEDULING_SURFACES: ReadonlySet<Surface> = new Set<Surface>(['diagnostic', 'test']);

export interface RecordReviewResult {
  eventId: string;
  conceptId: string;
  correct: boolean | null;
  /** What FSRS believed *before* this answer was shown (plan.md §6). */
  predictedRecall: number;
  gapDaysSinceLast: number | null;
  scheduled: boolean;
  due: Date | null;
  reps: number;
  /** One line for the learner, from the grader. Null when nothing was answered. */
  feedback: string | null;
}

export class ReviewError extends Error {
  constructor(
    public readonly reason: 'item_not_found',
    message: string,
  ) {
    super(message);
    this.name = 'ReviewError';
  }
}

const MS_PER_DAY = 86_400_000;

/**
 * Records one answer from any surface and, when the answer warrants it, moves
 * the card's FSRS schedule.
 *
 * `now` is injected rather than read from the clock so tests can time-travel
 * and so a queued offline answer (T-031) can be recorded at the time it was
 * actually given, not the time it synced.
 */
export async function recordReview(
  userId: string,
  answer: Answer,
  now: Date = new Date(),
): Promise<RecordReviewResult> {
  // Idempotency first: the extension retries from an offline queue (T-031), and
  // a retry must not schedule the card a second time. Scoped by user as well as
  // key so one user's retry can never read back another's event.
  if (answer.idempotencyKey) {
    const [existing] = await db
      .select()
      .from(reviewEvents)
      .where(and(eq(reviewEvents.idempotencyKey, answer.idempotencyKey), eq(reviewEvents.userId, userId)));

    if (existing) {
      const [card] = await db
        .select()
        .from(cards)
        .where(and(eq(cards.userId, userId), eq(cards.conceptId, existing.conceptId)));
      return {
        eventId: existing.id,
        conceptId: existing.conceptId,
        correct: existing.correct,
        predictedRecall: existing.predictedRecall,
        gapDaysSinceLast: existing.gapDaysSinceLast,
        scheduled: existing.cardId !== null,
        due: card?.due ?? null,
        reps: card?.reps ?? 0,
        // Not stored — a replayed answer returns the recorded outcome, not fresh feedback.
        feedback: null,
      };
    }
  }

  const [item] = await db
    .select({ conceptId: items.conceptId, payload: items.payload })
    .from(items)
    .where(eq(items.id, answer.itemId));
  if (!item) throw new ReviewError('item_not_found', `item ${answer.itemId} not found`);
  const { conceptId } = item;

  // Grading lives here rather than in the route so every surface gets it —
  // web, extension, diagnostic and test all go through recordReview, and a
  // per-route check would eventually be forgotten on one of them.
  //
  // `answer.correct` from the client is never used. The client can't grade
  // anyway (T-010 strips the answer key), and trusting it would let a learner
  // inflate the retention score the pilot exists to measure. No response means
  // nothing was answered — a snooze, a dismissal, or an auto-close — so
  // `correct` stays null rather than falling back to whatever was sent.
  //
  // A grader failure on an `explain` item propagates: a 500 makes the
  // extension's offline queue retry (T-031), which preserves the answer
  // without handing out a free pass.
  const graded =
    answer.response === null || answer.response === undefined
      ? null
      : await grade(ItemPayloadSchema.parse(item.payload), answer.response);
  const correct = graded?.correct ?? null;

  const [existingCard] = await db
    .select()
    .from(cards)
    .where(and(eq(cards.userId, userId), eq(cards.conceptId, conceptId)));

  const fsrsCard = existingCard ? fromDbCard(existingCard) : newCard(now);

  // Before scheduling, on purpose: this is the number the scheduler-calibration
  // metric compares against what actually happened (plan.md §6, T-040).
  const recall = predictedRecall(fsrsCard, now);

  // Gap is measured from the last answered review, not the last event: a
  // snooze or dismissal involves no retrieval, so counting from one would
  // understate the true gap and drop genuine data points out of T-040's
  // "did it stick" (correct with gap >= 1) bucket.
  const [previous] = await db
    .select({ createdAt: reviewEvents.createdAt })
    .from(reviewEvents)
    .where(
      and(
        eq(reviewEvents.userId, userId),
        eq(reviewEvents.conceptId, conceptId),
        isNotNull(reviewEvents.correct),
      ),
    )
    .orderBy(desc(reviewEvents.createdAt))
    .limit(1);

  // Whole days elapsed, floored: T-040's "did it stick" bucket is `gap >= 1`,
  // and rounding would promote a 13-hour gap into it.
  const gapDaysSinceLast = previous
    ? Math.floor((now.getTime() - previous.createdAt.getTime()) / MS_PER_DAY)
    : null;

  // The FSRS rating comes from the *graded* result, never the client's claim.
  // A null `correct` (nothing answered, snoozed, or dismissed) records the
  // event without touching the schedule.
  const shouldSchedule =
    correct !== null &&
    !answer.snoozed &&
    !answer.dismissed &&
    !NON_SCHEDULING_SURFACES.has(answer.surface);

  const scheduledCard = shouldSchedule
    ? scheduleReview(fsrsCard, correct ? Rating.Good : Rating.Again, now)
    : null;

  return db.transaction(async (tx) => {
    let cardId = existingCard?.id ?? null;

    if (scheduledCard) {
      const row = toDbCard(scheduledCard);
      const [upserted] = await tx
        .insert(cards)
        .values({ userId, conceptId, ...row })
        .onConflictDoUpdate({ target: [cards.userId, cards.conceptId], set: row })
        .returning({ id: cards.id, due: cards.due, reps: cards.reps });
      if (!upserted) throw new Error('card upsert returned no row');
      cardId = upserted.id;
    }

    const [event] = await tx
      .insert(reviewEvents)
      .values({
        userId,
        conceptId,
        itemId: answer.itemId,
        cardId: scheduledCard ? cardId : null,
        correct,
        confidence: answer.confidence,
        latencyMs: answer.latencyMs ?? null,
        snoozed: answer.snoozed ?? false,
        dismissed: answer.dismissed ?? false,
        surface: answer.surface,
        predictedRecall: recall,
        gapDaysSinceLast,
        idempotencyKey: answer.idempotencyKey ?? null,
        createdAt: now,
      })
      .returning({ id: reviewEvents.id });
    if (!event) throw new Error('review event insert returned no row');

    const [card] = await tx
      .select({ due: cards.due, reps: cards.reps })
      .from(cards)
      .where(and(eq(cards.userId, userId), eq(cards.conceptId, conceptId)));

    return {
      eventId: event.id,
      conceptId,
      correct,
      predictedRecall: recall,
      gapDaysSinceLast,
      scheduled: scheduledCard !== null,
      due: card?.due ?? null,
      reps: card?.reps ?? 0,
      feedback: graded?.feedback ?? null,
    };
  });
}
