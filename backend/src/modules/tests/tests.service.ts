import { and, eq } from 'drizzle-orm';
import { TestScoresSchema, type TestNext, type TestSubmit } from '@learnos/shared';
import { db } from '../../db/client.js';
import { tests, topics } from '../../db/schema.js';
import { recordReview } from '../../lib/recordReview.js';
import { toPublicItem } from '../../lib/publicItem.js';
import { estimatedSeconds, scoreTest } from '../../lib/testGen.js';
import { testIsDue } from '../../lib/testLifecycle.js';
import { RETIRED_FLAG_THRESHOLD } from '../../lib/retire.js';
import { existingTest, ownedTopic, storedItems, testAnswers, testEventKey, type TestDatabase } from './tests.repository.js';

export class TestError extends Error {
  constructor(public readonly reason: string, public readonly status = 409) { super(reason); }
}
export function itemIds(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || !value.every((v): v is string => typeof v === 'string'))
    throw new TestError('invalid_test');
  return value;
}
export async function readyTopic(userId: string, topicId: string, now: Date) {
  const owned = await ownedTopic(userId, topicId);
  if (!owned) throw new TestError('not_found', 404);
  const existing = await existingTest(topicId);
  if (!existing && !testIsDue(owned.topic, owned.timezone, now)) throw new TestError('test_not_due');
  return { ...owned, existing };
}
async function load(userId: string, id: string, database: TestDatabase = db, lock = false) {
  const query = database.select().from(tests).where(and(eq(tests.id, id), eq(tests.userId, userId), eq(tests.kind, 'day30')));
  const [test] = await (lock ? query.for('update') : query);
  if (!test) throw new TestError('not_found', 404);
  const ids = itemIds(test.itemIds);
  const rows = await storedItems(ids, database);
  if (rows.length !== ids.length) throw new TestError('test_item_unavailable');
  const answers = await testAnswers(userId, id, ids, database);
  const scored = TestScoresSchema.safeParse(test.scores);
  return { test, ids, rows, answers, scores: scored.success ? scored.data : undefined };
}
export async function nextTestItem(userId: string, id: string): Promise<TestNext> {
  const { ids, rows, answers, scores } = await load(userId, id);
  const nextId = ids.find((itemId) => !answers.some((a) => a.itemId === itemId));
  const row = rows.find((item) => item.id === nextId);
  if (row && row.flaggedBad >= RETIRED_FLAG_THRESHOLD) throw new TestError('test_item_retired');
  return { testId: id, done: !nextId, completed: !!scores, item: row && !scores ? toPublicItem(row) : null,
    progress: { answered: answers.length, total: ids.length },
    estimatedSeconds: rows.reduce((sum, item) => sum + estimatedSeconds(item), 0), ...(scores ? { scores } : {}) };
}
export async function answerTestItem(userId: string, id: string, answer: TestSubmit, now = new Date()) {
  await db.transaction(async (tx) => {
    // Serialises retries, answers and completion across processes. Recording the
    // review in this transaction makes acknowledgement and persistence atomic.
    const { ids, rows, answers, scores } = await load(userId, id, tx, true);
    if (!ids.includes(answer.itemId)) throw new TestError('item_not_in_test', 400);
    if (answers.some((a) => a.itemId === answer.itemId)) return; // First answer wins, even after completion.
    if (scores) throw new TestError('test_completed');
    if (ids.find((itemId) => !answers.some((a) => a.itemId === itemId)) !== answer.itemId)
      throw new TestError('answer_out_of_order');
    if (rows.find((item) => item.id === answer.itemId)!.flaggedBad >= RETIRED_FLAG_THRESHOLD)
      throw new TestError('test_item_retired');
    await recordReview(userId, { ...answer, surface: 'test', idempotencyKey: testEventKey(id, answer.itemId) }, now, tx);
  });
  // No correctness or feedback until the instrument is finished: a revealed
  // answer could teach a later question about the same concept.
  return nextTestItem(userId, id);
}
export async function completeTest(userId: string, id: string) {
  return db.transaction(async (tx) => {
    const { test, ids, rows, answers, scores: existing } = await load(userId, id, tx, true);
    if (existing) return existing;
    if (answers.length !== ids.length || answers.some((a) => a.correct === null || a.confidence === null))
      throw new TestError('test_incomplete');
    const scores = scoreTest(answers.map((a) => {
      const item = rows.find((row) => row.id === a.itemId)!;
      return { conceptId: item.conceptId, heldOut: item.heldOut, isTransfer: item.isTransfer,
        correct: a.correct === true, confidence: a.confidence! };
    }));
    await tx.update(tests).set({ scores }).where(eq(tests.id, id));
    await tx.update(topics).set({ status: 'done' }).where(eq(topics.id, test.topicId));
    return scores;
  });
}
