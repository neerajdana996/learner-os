/**
 * What the pilot actually measured (T-040).
 *
 * Every function here returns `null` rather than `0` when the input does not
 * exist. That distinction is the whole point: a learner who never sat the Day-45
 * test has *no* durability number, and averaging a fabricated zero into a cohort
 * mean would manufacture a decline that nobody experienced. Missing shows up in
 * the counts; a wrong number does not.
 *
 * Read-only. Nothing here writes, and nothing here decides anything the product
 * does — these are the numbers a human looks at afterwards.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { clientEvents, concepts, reviewEvents, tests } from '../db/schema.js';
import { TestScoresSchema, type TestScores } from '@learnos/shared';

/**
 * Surfaces that count as a *scheduled review*.
 *
 * The diagnostic measures prior knowledge and the Day-0/30/45 tests are
 * deliberately unscheduled — including either in a scheduler-calibration number
 * would be scoring FSRS on questions it never chose to ask.
 */
const REVIEW_SURFACES = ['web', 'extension'] as const;

/** A retrieval that can be scored: something was answered, and enough time had
 *  passed for it to be memory rather than echo. */
const scoredReview = (userId: string) =>
  and(
    eq(reviewEvents.userId, userId),
    sql`${reviewEvents.correct} is not null`,
    inArray(reviewEvents.surface, [...REVIEW_SURFACES]),
    sql`${reviewEvents.gapDaysSinceLast} >= 1`,
  );

async function scoresFor(userId: string, topicId: string, kind: 'day0' | 'day30' | 'day45') {
  const [row] = await db
    .select({ scores: tests.scores })
    .from(tests)
    .where(and(eq(tests.userId, userId), eq(tests.topicId, topicId), eq(tests.kind, kind)))
    .orderBy(sql`${tests.createdAt} desc`)
    .limit(1);

  if (!row) return null;
  const parsed = TestScoresSchema.safeParse(row.scores);
  // An unfinished test has `{}` in `scores`. That is not a zero — it is a test
  // that produced no measurement, and it must not enter an average.
  return parsed.success ? parsed.data : null;
}

export interface RetentionGain {
  taught: number | null;
  heldOut: number | null;
  /** The number the experiment exists to produce: how much better the taught
   *  concepts got than the ones we deliberately never taught. */
  gain: number | null;
  day0: TestScores | null;
  day30: TestScores | null;
}

/**
 * Day-30 minus Day-0, taught against held-out.
 *
 * The held-out arm is what makes this a measurement rather than a testimonial.
 * People get better at things over a month on their own; the only defensible
 * claim is the *difference* between concepts we taught and concepts we did not,
 * for the same person, on the same day, in the same sitting.
 *
 * `gain` is null unless all four numbers exist. A taught delta on its own is
 * the number a marketing page would quote and it is not evidence.
 */
export async function retentionGain(userId: string, topicId: string): Promise<RetentionGain> {
  const [day0, day30] = await Promise.all([
    scoresFor(userId, topicId, 'day0'),
    scoresFor(userId, topicId, 'day30'),
  ]);

  const taught = delta(day0?.taught, day30?.taught);
  const heldOut = delta(day0?.heldOut, day30?.heldOut);

  return {
    taught,
    heldOut,
    gain: taught === null || heldOut === null ? null : round(taught - heldOut),
    day0,
    day30,
  };
}

function delta(before: number | null | undefined, after: number | null | undefined): number | null {
  if (before === null || before === undefined || after === null || after === undefined) return null;
  return round(after - before);
}

/**
 * How much of the Day-30 result was still there at Day-45.
 *
 * A ratio, not a difference, because the question is "what fraction survived"
 * and a 10-point drop from 90 is not the same event as a 10-point drop from 20.
 * Null when either test is missing, and null when Day-30 was zero — there is no
 * meaningful proportion of nothing.
 */
export async function durability(userId: string, topicId: string): Promise<number | null> {
  const [day30, day45] = await Promise.all([
    scoresFor(userId, topicId, 'day30'),
    scoresFor(userId, topicId, 'day45'),
  ]);
  const before = day30?.taught;
  const after = day45?.taught;
  if (before === null || before === undefined || after === null || after === undefined) return null;
  if (before === 0) return null;
  return round(after / before);
}

/** Performance on transfer items — questions the learner has never seen, on
 *  concepts they were taught. Already scored when the test was graded. */
export async function transfer(userId: string, topicId: string): Promise<number | null> {
  return (await scoresFor(userId, topicId, 'day30'))?.transfer ?? null;
}

/**
 * Whether the learner got better at knowing what they know.
 *
 * `calibrationGap` is confidence minus accuracy: positive is overconfidence.
 * A **negative** delta is the improvement — the gap shrank — which is worth
 * saying out loud, because the sign reads backwards from every other metric here.
 */
export async function calibrationGapDelta(userId: string, topicId: string): Promise<number | null> {
  const [day0, day30] = await Promise.all([
    scoresFor(userId, topicId, 'day0'),
    scoresFor(userId, topicId, 'day30'),
  ]);
  if (!day0 || !day30) return null;
  return round(day30.calibrationGap - day0.calibrationGap);
}

export interface CalibrationBin {
  /** Lower edge, e.g. 0.8 for the 0.8–0.9 bin. */
  bin: number;
  predicted: number;
  actual: number;
  n: number;
}

/**
 * Is the scheduler telling the truth? (plan.md §6.)
 *
 * FSRS predicts a recall probability before every review. Bin those predictions
 * 0.1 wide and compare each bin's mean prediction against what actually
 * happened. A well-calibrated scheduler puts ~80% correct in the 0.8 bin. This
 * is the number that says whether the spacing is working or whether it merely
 * feels like it is.
 *
 * Reviews only, and `gap >= 1` only: answering something ten minutes after
 * seeing it measures short-term echo, and including it would flatter every bin.
 */
export async function schedulerCalibration(userId: string): Promise<CalibrationBin[]> {
  const rows = await db
    .select({
      bin: sql<number>`floor(${reviewEvents.predictedRecall} * 10) / 10`,
      predicted: sql<number>`avg(${reviewEvents.predictedRecall})`,
      actual: sql<number>`avg(case when ${reviewEvents.correct} then 1.0 else 0.0 end)`,
      n: sql<number>`count(*)`,
    })
    .from(reviewEvents)
    .where(scoredReview(userId))
    .groupBy(sql`floor(${reviewEvents.predictedRecall} * 10) / 10`)
    .orderBy(sql`floor(${reviewEvents.predictedRecall} * 10) / 10`);

  return rows.map((r) => ({
    bin: round(Number(r.bin)),
    predicted: round(Number(r.predicted)),
    actual: round(Number(r.actual)),
    n: Number(r.n),
  }));
}

export interface TeachModeRow {
  teachMode: 'try_first' | 'example_first' | null;
  meanCorrect: number;
  n: number;
}

/**
 * Does making someone try first before showing them the answer help?
 *
 * Grouped by the concept's `teach_mode`, over scored reviews only. This is an
 * observational comparison inside one learner, not a randomised one — concepts
 * are assigned a mode by the generator, not by a coin flip — so it can suggest
 * a direction and cannot establish a cause. Worth having; worth not overclaiming.
 */
export async function teachModeComparison(userId: string): Promise<TeachModeRow[]> {
  const rows = await db
    .select({
      teachMode: concepts.teachMode,
      meanCorrect: sql<number>`avg(case when ${reviewEvents.correct} then 1.0 else 0.0 end)`,
      n: sql<number>`count(*)`,
    })
    .from(reviewEvents)
    .innerJoin(concepts, eq(reviewEvents.conceptId, concepts.id))
    .where(scoredReview(userId))
    .groupBy(concepts.teachMode)
    .orderBy(concepts.teachMode);

  return rows.map((r) => ({
    teachMode: r.teachMode,
    meanCorrect: round(Number(r.meanCorrect)),
    n: Number(r.n),
  }));
}

export interface ExtensionStats {
  shown: number;
  answered: number;
  snoozed: number;
  dismissed: number;
  closedNoAction: number;
  /** answered / shown, or null when nothing was ever shown. */
  answerRate: number | null;
  medianLatencyMs: number | null;
}

/**
 * What actually happened to the cards the extension put in front of someone.
 *
 * **`shown` comes from `client_events`, not from `review_events`** (T-035), and
 * that is the only place it can come from: the server knows what it *served*,
 * and a card is fetched, stored, and then announced. A learner who never opens
 * the notification produces no review row at all, so an answer rate computed
 * from review rows alone would be a ratio of answers to answers.
 *
 * `closedNoAction` is the popup being destroyed with the question unanswered —
 * Chrome closes it the moment it loses focus. Before T-035 this whole category
 * was invisible, which meant the answer rate was silently measuring the wrong
 * denominator.
 */
export async function extensionStats(userId: string): Promise<ExtensionStats> {
  const [events] = await db
    .select({
      shown: sql<number>`count(*) filter (where ${clientEvents.event} = 'card_shown')`,
      closedNoAction: sql<number>`count(*) filter (where ${clientEvents.event} = 'card_closed_no_action')`,
    })
    .from(clientEvents)
    .where(eq(clientEvents.userId, userId));

  const [reviews] = await db
    .select({
      answered: sql<number>`count(*) filter (where ${reviewEvents.correct} is not null)`,
      snoozed: sql<number>`count(*) filter (where ${reviewEvents.snoozed})`,
      dismissed: sql<number>`count(*) filter (where ${reviewEvents.dismissed})`,
      // percentile_cont over answered rows only: a snooze has a latency that
      // measures how long someone took to decline, which is a different thing.
      medianLatencyMs: sql<number | null>`percentile_cont(0.5) within group (
        order by ${reviewEvents.latencyMs}
      ) filter (where ${reviewEvents.correct} is not null and ${reviewEvents.latencyMs} is not null)`,
    })
    .from(reviewEvents)
    .where(and(eq(reviewEvents.userId, userId), eq(reviewEvents.surface, 'extension')));

  const shown = Number(events?.shown ?? 0);
  const answered = Number(reviews?.answered ?? 0);

  return {
    shown,
    answered,
    snoozed: Number(reviews?.snoozed ?? 0),
    dismissed: Number(reviews?.dismissed ?? 0),
    closedNoAction: Number(events?.closedNoAction ?? 0),
    // Null, not zero: no cards shown is "we have not measured this yet", and a
    // 0% answer rate is a damning finding. They must never look the same.
    answerRate: shown === 0 ? null : round(answered / shown),
    medianLatencyMs:
      reviews?.medianLatencyMs === null || reviews?.medianLatencyMs === undefined
        ? null
        : Math.round(Number(reviews.medianLatencyMs)),
  };
}

/** Four decimals: these are proportions, and more precision than the sample
 *  supports reads as confidence the data does not have. */
function round(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
