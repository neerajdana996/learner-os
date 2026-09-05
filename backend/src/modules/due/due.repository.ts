import { and, asc, desc, eq, inArray, isNotNull, lt, lte } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { cards, concepts, items, reviewEvents, topics } from '../../db/schema.js';
import { RETIRED_FLAG_THRESHOLD } from '../../lib/retire.js';

export const RECENT_WINDOW = 3;

export async function findDueCards(userId: string, now: Date, limit: number) {
  const rows = await db
    .select({ conceptId: cards.conceptId, due: cards.due, taughtAt: cards.taughtAt, heldOut: concepts.heldOut, topicStatus: topics.status })
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

  console.log('[findDueCards] query result', {
    userId,
    now: now.toISOString(),
    limit,
    rows,
  });

  return rows.map((row) => ({ conceptId: row.conceptId, due: row.due }));
}

/** Retired items (T-024's `pnpm qa:retire`, and the backlog's auto-retire) are
 *  excluded here: a question the founder rejected must never be asked again. */
export async function findCandidates(conceptIds: string[]) {
  return db
    .select({ id: items.id, conceptId: items.conceptId, payload: items.payload })
    .from(items)
    .where(
      and(inArray(items.conceptId, conceptIds), lt(items.flaggedBad, RETIRED_FLAG_THRESHOLD)),
    );
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