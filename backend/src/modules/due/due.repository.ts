import { and, asc, desc, eq, exists, inArray, isNotNull, lt, lte } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { cards, concepts, items, reviewEvents, topics } from '../../db/schema.js';
import { RETIRED_FLAG_THRESHOLD } from '../../lib/retire.js';
import { withinTeachingWindow } from '../../lib/courseWindow.js';
import { popupEligible, reviewEligible } from '../../lib/popupEligible.js';

export const RECENT_WINDOW = 3;

/**
 * Everything that makes an item servable on a surface, in one place (T-169).
 *
 * Two queries need this and they must not drift: `findCandidates` picks the
 * item to serve, and `findDueCards` uses the same conditions in an `EXISTS` so
 * the LIMIT is spent on cards that actually have one. Written as a function
 * rather than repeated, because the failure when they disagree is silent — a
 * card counted as due and then dropped, which is exactly what T-169 was.
 */
function servableItem(popupOnly: boolean) {
  return and(
    lt(items.flaggedBad, RETIRED_FLAG_THRESHOLD),
    // Everything these queries return is a review, on either surface, and a
    // `codeEditor` is never a review (T-088).
    reviewEligible(),
    // Asserted in SQL rather than filtered in the client (T-089): a caller
    // that forgets cannot serve a four-minute question to a popup.
    ...(popupOnly ? [popupEligible()] : []),
  );
}

/**
 * `popupOnly` reaches this far down for T-169. The LIMIT used to be spent on
 * due *cards* and eligibility applied afterwards to their *items*, so a card
 * whose only item the surface may not serve consumed a row and then dropped
 * out — and the popup asks for exactly one. A learner whose earliest-due
 * concept happened to hold a `codeEditor` was told "nothing due right now"
 * while their whole queue was waiting, which is the quietest way this product
 * can fail: the extension simply stops asking.
 */
export async function findDueCards(userId: string, now: Date, limit: number, popupOnly = false) {
  const rows = await db
    .select({ conceptId: cards.conceptId, conceptTitle: concepts.title, due: cards.due, taughtAt: cards.taughtAt, heldOut: concepts.heldOut, topicStatus: topics.status })
    .from(cards)
    .innerJoin(concepts, eq(cards.conceptId, concepts.id))
    .innerJoin(topics, eq(concepts.topicId, topics.id))
    .where(
      and(
        eq(cards.userId, userId),
        lte(cards.due, now),
        isNotNull(cards.taughtAt),
        eq(concepts.heldOut, false),
        withinTeachingWindow(now),
        // The card only counts as due if this surface can actually serve one
        // of its items — otherwise it eats a row of the LIMIT and vanishes.
        exists(
          db
            .select({ one: items.id })
            .from(items)
            .where(and(eq(items.conceptId, cards.conceptId), servableItem(popupOnly))),
        ),
      ),
    )
    .orderBy(asc(cards.due))
    .limit(limit);


  // The title comes back because `/due` may show it: every row here is taught
  // and not held out, so naming the concept reveals nothing (T-130).
  return rows.map((row) => ({ conceptId: row.conceptId, conceptTitle: row.conceptTitle, due: row.due }));
}

/** Retired items (T-024's `pnpm qa:retire`, and the backlog's auto-retire) are
 *  excluded here: a question the founder rejected must never be asked again. */
export async function findCandidates(conceptIds: string[], popupOnly = false) {
  return db
    .select({ id: items.id, conceptId: items.conceptId, payload: items.payload })
    .from(items)
    .where(
      and(
        inArray(items.conceptId, conceptIds),
        servableItem(popupOnly),
      ),
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