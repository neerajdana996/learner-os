import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { cards, conceptPrereqs, concepts, items, reviewEvents, tests, topics, users } from '../../db/schema.js';

export async function findOwnedTopic(topicId: string, userId: string) {
  const [topic] = await db
    .select()
    .from(topics)
    .where(and(eq(topics.id, topicId), eq(topics.userId, userId)));
  return topic ?? null;
}

export async function findConcepts(topicId: string) {
  return db
    .select({
      id: concepts.id,
      title: concepts.title,
      order: concepts.order,
      heldOut: concepts.heldOut,
    })
    .from(concepts)
    .where(eq(concepts.topicId, topicId))
    .orderBy(asc(concepts.order));
}

export async function findPrereqEdges(topicId: string) {
  return db
    .select({
      conceptId: conceptPrereqs.conceptId,
      prerequisiteConceptId: conceptPrereqs.prerequisiteConceptId,
    })
    .from(conceptPrereqs)
    .innerJoin(concepts, eq(conceptPrereqs.conceptId, concepts.id))
    .where(eq(concepts.topicId, topicId));
}

export async function saveDiagnosticState(topicId: string, state: unknown) {
  await db.update(topics).set({ diagnosticState: state }).where(eq(topics.id, topicId));
}

/** Any item for the concept — the diagnostic measures the concept, not a
 *  specific question, and item rotation is T-010's concern for reviews. */
export async function findItemForConcept(conceptId: string) {
  const [item] = await db
    .select({ id: items.id, conceptId: items.conceptId, payload: items.payload })
    .from(items)
    .where(eq(items.conceptId, conceptId))
    .limit(1);
  return item ?? null;
}

export async function findDiagnosticAnswers(userId: string, conceptIds: string[]) {
  if (conceptIds.length === 0) return [];
  return db
    .select({ confidence: reviewEvents.confidence, correct: reviewEvents.correct })
    .from(reviewEvents)
    .where(
      and(
        eq(reviewEvents.userId, userId),
        eq(reviewEvents.surface, 'diagnostic'),
        inArray(reviewEvents.conceptId, conceptIds),
      ),
    );
}

export interface CardSeed {
  conceptId: string;
  due: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview: Date | null;
  taughtAt: Date | null;
}

/**
 * Everything the finish step writes, in one transaction: the cards the learner
 * will be scheduled on, the day-0 test record, and their calibration gap.
 */
export async function persistCompletion(params: {
  userId: string;
  topicId: string;
  seeds: CardSeed[];
  scores: unknown;
  calibrationGap: number | null;
  profile: Record<string, unknown>;
}) {
  await db.transaction(async (tx) => {
    if (params.seeds.length > 0) {
      await tx
        .insert(cards)
        .values(params.seeds.map((seed) => ({ userId: params.userId, ...seed })))
        // The diagnostic can only be finished once per topic, but a retried
        // request must not explode on the (user, concept) unique index.
        .onConflictDoNothing({ target: [cards.userId, cards.conceptId] });
    }

    await tx.insert(tests).values({
      userId: params.userId,
      topicId: params.topicId,
      kind: 'day0',
      itemIds: [],
      scores: params.scores,
    });

    await tx
      .update(users)
      .set({ profile: { ...params.profile, calibrationGap: params.calibrationGap } })
      .where(eq(users.id, params.userId));
  });
}
