import { and, count, desc, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { concepts, items, topics } from '../../db/schema.js';

export async function insertTopic(values: typeof topics.$inferInsert) {
  return db.insert(topics).values(values).returning({ id: topics.id, status: topics.status });
}

export function listTopics(userId: string) {
  return db
    .select({ id: topics.id, title: topics.title, status: topics.status, createdAt: topics.createdAt })
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