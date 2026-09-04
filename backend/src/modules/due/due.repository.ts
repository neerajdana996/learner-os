import { and, asc, desc, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { cards, concepts, items, reviewEvents, topics } from '../../db/schema.js';

export const RECENT_WINDOW = 3;

export async function findDueCards(userId: string, now: Date, limit: number) {
  return db
    .select({ conceptId: cards.conceptId, due: cards.due })
    .from(cards)
    .innerJoin(concepts, eq(cards.conceptId, concepts.id))
    .innerJoin(topics, eq(concepts.topicId, topics.id))
    .where(
      and(
        eq(cards.userId, userId),
        lte(cards.due, now),
        isNotNull(cards.taughtAt),
        eq(concepts.heldOut, false),
        eq(topics.status, 'active'),
      ),
    )
    .orderBy(asc(cards.due))
    .limit(limit);
}

export async function findCandidates(conceptIds: string[]) {
  return db
    .select({ id: items.id, conceptId: items.conceptId, payload: items.payload })
    .from(items)
    .where(inArray(items.conceptId, conceptIds));
}

export async function findRecentHistory(userId: string, conceptIds: string[]) {
  return db
    .select({ conceptId: reviewEvents.conceptId, itemId: reviewEvents.itemId })
    .from(reviewEvents)
    .where(
      and(
        eq(reviewEvents.userId, userId),
        inArray(reviewEvents.conceptId, conceptIds),
        isNotNull(reviewEvents.itemId),
      ),
    )
    .orderBy(desc(reviewEvents.createdAt));
}