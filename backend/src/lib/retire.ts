import { lt, type SQL } from 'drizzle-orm';
import { items } from '../db/schema.js';

/**
 * A retired item — one the founder rejected during content QA (T-024) — must
 * never be served again.
 *
 * Retirement rides on `items.flagged_bad` rather than a new column, because
 * sprint.md's backlog already plans an auto-retire at `flagged_bad >= 3` from
 * learner reports; one threshold means a manually retired item and an
 * auto-retired one are excluded by exactly the same rule.
 */
export const RETIRED_FLAG_THRESHOLD = 3;

/**
 * The rule as SQL, for every query that picks an item (T-062).
 *
 * It used to be written out at each call site, and only two of the five had it:
 * `/due` and the cold test's candidates. The session's post-teaching retrieval
 * item and the diagnostic's per-concept item both read straight from the table,
 * so a question the founder had rejected as *wrong* was still taught with, and
 * still asked — the worst of it in the Day-30 test, where it is scored.
 *
 * One exported condition rather than four copies: a query added later gets the
 * rule by using the helper, and `retire.test.ts` fails if the threshold is ever
 * compared anywhere else.
 */
export function notRetired(): SQL {
  return lt(items.flaggedBad, RETIRED_FLAG_THRESHOLD);
}

/** The same rule for a row already loaded — the cold test checks an item it
 *  has just fetched, rather than filtering a query. */
export function isRetired(flaggedBad: number): boolean {
  return flaggedBad >= RETIRED_FLAG_THRESHOLD;
}
