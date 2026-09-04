import { Router } from 'express';
import { and, asc, desc, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import { db } from '../db/client.js';
import { cards, concepts, items, reviewEvents, topics } from '../db/schema.js';
import { validate } from '../lib/validate.js';
import { toPublicItem } from '../lib/publicItem.js';
import { requireUser, userId } from '../middleware/auth.js';
import { DueQuerySchema, type DueItemsResponse, type DueQuery } from '../shared/index.js';

export const dueRouter = Router();

/** How many recent reviews of a concept make an item "recently seen". */
const RECENT_WINDOW = 3;

/**
 * The queue the extension pulls from. Four filters, each load-bearing:
 *   due <= now          — not yet time to ask again
 *   taughtAt NOT NULL   — never ask about something we haven't taught
 *   concept.heldOut     — held-out concepts are the control group (plan.md §6)
 *   topic.status active — silences the extension during the Day 31-45 holdout
 *                         and while a topic is still generating (T-039)
 */
dueRouter.get('/due', requireUser, validate(DueQuerySchema, 'query'), async (req, res) => {
  const { limit } = req.query as unknown as DueQuery;
  const user = userId(req);
  const now = new Date();

  const dueCards = await db
    .select({ conceptId: cards.conceptId, due: cards.due })
    .from(cards)
    .innerJoin(concepts, eq(cards.conceptId, concepts.id))
    .innerJoin(topics, eq(concepts.topicId, topics.id))
    .where(
      and(
        eq(cards.userId, user),
        lte(cards.due, now),
        isNotNull(cards.taughtAt),
        eq(concepts.heldOut, false),
        eq(topics.status, 'active'),
      ),
    )
    .orderBy(asc(cards.due))
    .limit(limit);

  if (dueCards.length === 0) {
    res.json({ items: [] } satisfies DueItemsResponse);
    return;
  }

  const conceptIds = dueCards.map((card) => card.conceptId);

  const candidates = await db
    .select({ id: items.id, conceptId: items.conceptId, payload: items.payload })
    .from(items)
    .where(inArray(items.conceptId, conceptIds));

  // Recent history for just these concepts. Sliced to the last few per concept
  // in JS rather than with a window function: the row count is bounded by a
  // pilot's worth of reviews across at most `limit` concepts. Revisit if
  // history grows.
  const history = await db
    .select({ conceptId: reviewEvents.conceptId, itemId: reviewEvents.itemId })
    .from(reviewEvents)
    .where(
      and(
        eq(reviewEvents.userId, user),
        inArray(reviewEvents.conceptId, conceptIds),
        isNotNull(reviewEvents.itemId),
      ),
    )
    .orderBy(desc(reviewEvents.createdAt));

  const recentByConcept = new Map<string, string[]>();
  for (const row of history) {
    const seen = recentByConcept.get(row.conceptId) ?? [];
    if (seen.length < RECENT_WINDOW && row.itemId) {
      seen.push(row.itemId);
      recentByConcept.set(row.conceptId, seen);
    }
  }

  const byConcept = new Map<string, typeof candidates>();
  for (const item of candidates) {
    byConcept.set(item.conceptId, [...(byConcept.get(item.conceptId) ?? []), item]);
  }

  // One item per concept, preferring one the user hasn't just seen so a card
  // isn't asked with the identical question every time; any item if they've all
  // come up recently.
  const payload: DueItemsResponse = { items: [] };
  for (const card of dueCards) {
    const pool = byConcept.get(card.conceptId) ?? [];
    if (pool.length === 0) continue;
    const recent = new Set(recentByConcept.get(card.conceptId) ?? []);
    const unseen = pool.filter((item) => !recent.has(item.id));
    const chosen = (unseen.length > 0 ? unseen : pool)[0];
    if (chosen) payload.items.push(toPublicItem(chosen));
  }

  res.json(payload);
});
