import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { items } from '../../db/schema.js';

/**
 * One learner report against one question.
 *
 * `flagged_bad` is incremented in the statement rather than read-then-written:
 * two learners reporting the same item at once would otherwise both read the
 * same value and one report would vanish. It is a count of complaints, and a
 * lost complaint is a bad question that stays in circulation.
 */
export async function incrementFlag(itemId: string) {
  const [updated] = await db
    .update(items)
    .set({ flaggedBad: sql`${items.flaggedBad} + 1` })
    .where(eq(items.id, itemId))
    .returning({ id: items.id, flaggedBad: items.flaggedBad });

  return updated ?? null;
}

/** The stored payload, for the one field the public projection strips. */
export async function findItemPayload(itemId: string) {
  const [row] = await db
    .select({ payload: items.payload })
    .from(items)
    .where(eq(items.id, itemId));

  return row?.payload ?? null;
}
