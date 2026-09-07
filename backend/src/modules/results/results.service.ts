import { and, asc, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { concepts, tests, topics } from '../../db/schema.js';
import { TestScoresSchema, type ResultsResponse } from '@learnos/shared';

export class ResultsError extends Error {
  constructor(readonly reason: 'not_found') {
    super(reason);
    this.name = 'ResultsError';
  }
}

/**
 * What the learner is told at the end (T-042).
 *
 * **Scoped to the caller's own topic.** The `and(userId, topicId)` is the whole
 * access control: without it, a learner could read another participant's
 * results by pasting a topic id, and this page contains the most personal thing
 * the product produces — a list of what they failed to remember.
 *
 * Held-out concept titles *are* returned here, and only here. During the
 * experiment they are withheld (T-010) because knowing what is not being taught
 * is knowing what to go and read. Once the Day-30 test is submitted that is
 * over, and hiding them afterwards would be withholding the learner's own
 * result from them.
 */
export async function resultsFor(userId: string, topicId: string): Promise<ResultsResponse> {
  const [topic] = await db
    .select({ id: topics.id, title: topics.title })
    .from(topics)
    .where(and(eq(topics.id, topicId), eq(topics.userId, userId)));

  if (!topic) throw new ResultsError('not_found');

  const [day30] = await db
    .select({ scores: tests.scores })
    .from(tests)
    .where(and(eq(tests.userId, userId), eq(tests.topicId, topicId), eq(tests.kind, 'day30')))
    .orderBy(asc(tests.createdAt))
    .limit(1);

  const parsed = day30 ? TestScoresSchema.safeParse(day30.scores) : null;
  const scores = parsed?.success ? parsed.data : null;

  const rows = await db
    .select({ id: concepts.id, title: concepts.title, heldOut: concepts.heldOut })
    .from(concepts)
    .where(eq(concepts.topicId, topicId))
    .orderBy(asc(concepts.order));

  return {
    topicId: topic.id,
    topicTitle: topic.title,
    taught: scores?.taught ?? null,
    heldOut: scores?.heldOut ?? null,
    calibrationGap: scores?.calibrationGap ?? null,
    concepts: rows.map((c) => ({
      conceptId: c.id,
      title: c.title,
      heldOut: c.heldOut,
      // Absent from `perConcept` means no question on this concept was asked —
      // a 25-item test does not cover 16 concepts evenly. Null, not zero: "we
      // did not ask" and "you got it wrong" must not look the same.
      score: scores?.perConcept?.[c.id] ?? null,
    })),
  };
}
