import { and, asc, eq, gte, inArray, isNotNull, lt, notExists, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { cards, concepts, items, reviewEvents, tests, topics, users } from '../../db/schema.js';
import { popupEligible } from '../../lib/popupEligible.js';
import { RETIRED_FLAG_THRESHOLD } from '../../lib/retire.js';
import { fromDbCard, predictedRecall } from '../../scheduler/index.js';

export type TestDatabase = Pick<typeof db, 'select'>;
export const testEventKey = (testId: string, itemId: string) => `test/${testId}/${itemId}`;

export async function ownedTopic(userId: string, topicId: string, database: TestDatabase = db) {
  const [row] = await database.select({ topic: topics, timezone: users.timezone, email: users.email })
    .from(topics).innerJoin(users, eq(users.id, topics.userId))
    .where(and(eq(topics.id, topicId), eq(topics.userId, userId)));
  return row;
}
export async function existingTest(topicId: string, database: TestDatabase = db) {
  const [row] = await database.select().from(tests)
    .where(and(eq(tests.topicId, topicId), eq(tests.kind, 'day30'))).orderBy(asc(tests.createdAt)).limit(1);
  return row;
}
export async function testConcepts(userId: string, topicId: string, now: Date, database: TestDatabase = db) {
  const rows = await database.select({ concept: concepts, card: cards }).from(concepts)
    .leftJoin(cards, and(eq(cards.conceptId, concepts.id), eq(cards.userId, userId)))
    .where(eq(concepts.topicId, topicId)).orderBy(asc(concepts.order));
  return rows.map(({ concept, card }) => ({ ...concept,
    taught: card?.taughtAt !== null && card?.taughtAt !== undefined,
    mastery: card ? predictedRecall(fromDbCard(card), now) : 0,
  }));
}
/** Both test creation and retrieval use the exact popup predicate in SQL. */
export async function testCandidates(userId: string, topicId: string, now: Date, database: TestDatabase = db) {
  return database.select({ id: items.id, conceptId: items.conceptId, payload: items.payload,
    type: items.type, answerKind: items.answerKind, isTransfer: items.isTransfer })
    .from(items).innerJoin(concepts, eq(concepts.id, items.conceptId))
    .where(and(eq(concepts.topicId, topicId), popupEligible(), lt(items.flaggedBad, RETIRED_FLAG_THRESHOLD),
      notExists(database.select({ one: sql`1` }).from(reviewEvents).where(and(
        eq(reviewEvents.userId, userId), eq(reviewEvents.itemId, items.id), isNotNull(reviewEvents.correct),
        gte(reviewEvents.createdAt, new Date(now.getTime() - 7 * 86_400_000)),
      ))))).orderBy(asc(items.id));
}
export async function storedItems(ids: string[], database: TestDatabase = db) {
  if (!ids.length) return [];
  return database.select({ id: items.id, conceptId: items.conceptId, payload: items.payload,
    type: items.type, answerKind: items.answerKind, isTransfer: items.isTransfer, heldOut: concepts.heldOut,
    flaggedBad: items.flaggedBad })
    .from(items).innerJoin(concepts, eq(concepts.id, items.conceptId))
    .where(and(inArray(items.id, ids), popupEligible()));
}
export async function testAnswers(userId: string, testId: string, ids: string[], database: TestDatabase = db) {
  if (!ids.length) return [];
  return database.select().from(reviewEvents).where(and(eq(reviewEvents.userId, userId),
    eq(reviewEvents.surface, 'test'), inArray(reviewEvents.idempotencyKey, ids.map((id) => testEventKey(testId, id)))));
}
