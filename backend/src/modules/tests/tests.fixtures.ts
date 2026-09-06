import { db } from '../../db/client.js';
import { cards, concepts, items, topics, users } from '../../db/schema.js';
import { seedUser } from '../../test/db.js';
import { eq } from 'drizzle-orm';

export const DAY = 86_400_000;
export const NOW = new Date('2026-10-01T07:00:00Z');
export async function seedColdTopic(now = NOW) {
  const user = await seedUser();
  await db.update(users).set({ timezone: 'UTC' }).where(eq(users.id, user.id));
  const [topic] = await db.insert(topics).values({ userId: user.id, title: 'React Hooks', status: 'active',
    startsAt: new Date(now.getTime() - 30 * DAY), endsAt: new Date(now.getTime() - 23 * DAY) }).returning();
  if (!topic) throw new Error('Missing topic');
  const conceptRows = await db.insert(concepts).values(Array.from({ length: 16 }, (_, i) => ({
    topicId: topic.id, slug: `c${i}`, title: `Concept ${i}`, summary: 'A test concept', order: i + 1, heldOut: i >= 14,
  }))).returning();
  await db.insert(cards).values(conceptRows.filter((c) => !c.heldOut).map((c, i) => ({
    userId: user.id, conceptId: c.id, taughtAt: new Date(now.getTime() - 25 * DAY),
    due: new Date(now.getTime() - DAY), lastReview: new Date(now.getTime() - 23 * DAY),
    stability: [1, 30, 200][i % 3], state: 2, reps: 3,
  })));
  const itemRows = await db.insert(items).values(conceptRows.flatMap((c) => Array.from({ length: c.heldOut ? 1 : 5 }, (_, i) => ({
    conceptId: c.id, type: 'recall' as const, payload: { type: 'recall', prompt: `Question ${c.slug} ${i}`, answer: 'yes', accept: [] }, isTransfer: i === 4,
  })))).returning();
  return { user, topic, concepts: conceptRows, items: itemRows };
}
