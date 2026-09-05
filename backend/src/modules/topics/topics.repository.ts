import { and, count, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { concepts, items, topics } from '../../db/schema.js';

export async function insertTopic(values: typeof topics.$inferInsert) {
  return db.insert(topics).values(values).returning({ id: topics.id, status: topics.status });
}

/**
 * The same shape `findTopic` returns, so one `TopicSummary` type describes both
 * (T-072).
 *
 * It used to select four columns while the frontend's type claimed nine, and
 * TypeScript could not see the lie because that type is hand-written on the
 * client. The dashboard read `endsAt` off the list, got `undefined`, and told
 * every learner "final day" from day one.
 *
 * Counts come from correlated subqueries rather than two extra round trips:
 * the list is one row per topic, and a learner has one topic in the pilot.
 */
export function listTopics(userId: string) {
  const conceptCount = db
    .select({ n: count() })
    .from(concepts)
    .where(eq(concepts.topicId, topics.id));
  const itemCount = db
    .select({ n: count() })
    .from(items)
    .innerJoin(concepts, eq(items.conceptId, concepts.id))
    .where(eq(concepts.topicId, topics.id));

  return db
    .select({
      id: topics.id,
      title: topics.title,
      why: topics.why,
      language: topics.language,
      status: topics.status,
      error: topics.error,
      startsAt: topics.startsAt,
      endsAt: topics.endsAt,
      dailyBudgetMin: topics.dailyBudgetMin,
      createdAt: topics.createdAt,
      concepts: sql<number>`(${conceptCount})`.mapWith(Number),
      items: sql<number>`(${itemCount})`.mapWith(Number),
    })
    .from(topics)
    .where(eq(topics.userId, userId))
    .orderBy(desc(topics.createdAt));
}

export async function findTopic(userId: string, id: string) {
  const [topic] = await db.select().from(topics).where(and(eq(topics.id, id), eq(topics.userId, userId)));
  if (!topic) return null;
  const [conceptCount] = await db.select({ n: count() }).from(concepts).where(eq(concepts.topicId, id));
  const [itemCount] = await db
    .select({ n: count() })
    .from(items)
    .innerJoin(concepts, eq(items.conceptId, concepts.id))
    .where(eq(concepts.topicId, id));
  return { topic, counts: { concepts: conceptCount?.n ?? 0, items: itemCount?.n ?? 0 } };
}