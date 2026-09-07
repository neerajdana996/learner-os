import { and, asc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { cards, concepts, topics } from '../db/schema.js';
import { withinTeachingWindow } from './courseWindow.js';

/**
 * Bring a learner's next reviews forward to now (T-128, development only).
 *
 * After a session, FSRS schedules the first review hours or days out. That is
 * correct behaviour and it makes the extension impossible to try: the popup
 * says "nothing due right now", and short of editing the system clock there is
 * no way to see a card. This moves the cards instead of the clock.
 *
 * **Only cards `/due` would actually serve.** It filters on the same conditions
 * as `findDueCards` — taught, not held out, inside the teaching window — so a
 * card brought forward here is one the extension will really pop. Moving a
 * held-out concept's card would create a queue entry that the due query then
 * silently drops, which looks exactly like this endpoint not working.
 *
 * Everything else about the card is left alone: `stability`, `difficulty`,
 * `reps` and `taughtAt` all stay as they were, so the next real review still
 * schedules from the learner's actual history rather than from a fake one.
 */
export async function makeDue(userId: string, count: number, now = new Date()): Promise<number> {
  const candidates = await db
    .select({ id: cards.id })
    .from(cards)
    .innerJoin(concepts, eq(cards.conceptId, concepts.id))
    .innerJoin(topics, eq(concepts.topicId, topics.id))
    .where(
      and(
        eq(cards.userId, userId),
        isNotNull(cards.taughtAt),
        eq(concepts.heldOut, false),
        withinTeachingWindow(now),
      ),
    )
    // Soonest first, so "bring 5 forward" takes the 5 nearest rather than an
    // arbitrary five — the queue a learner would have met next anyway.
    .orderBy(asc(cards.due))
    .limit(count);

  if (candidates.length === 0) return 0;

  await db
    .update(cards)
    .set({
      // A second in the past, not exactly now: `findDueCards` uses `due <= now`
      // and a card stamped at the same millisecond as the request is a race
      // that fails intermittently and looks like a bug in the extension.
      due: new Date(now.getTime() - 1000),
    })
    .where(
      and(
        eq(cards.userId, userId),
        inArray(
          cards.id,
          candidates.map((card) => card.id),
        ),
      ),
    );

  return candidates.length;
}

/** How many of this user's cards `/due` would serve right now. Useful for
 *  telling "nothing is scheduled" apart from "nothing is due yet". */
export async function countDue(userId: string, now = new Date()): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(cards)
    .innerJoin(concepts, eq(cards.conceptId, concepts.id))
    .innerJoin(topics, eq(concepts.topicId, topics.id))
    .where(
      and(
        eq(cards.userId, userId),
        isNotNull(cards.taughtAt),
        eq(concepts.heldOut, false),
        withinTeachingWindow(now),
        // `lte`, not a raw sql fragment: postgres.js cannot bind a JS Date
        // through a template hole, and drizzle's operator carries the type.
        lte(cards.due, now),
      ),
    );
  return Number(row?.n ?? 0);
}
