import { RETIRED_FLAG_THRESHOLD } from '../../lib/retire.js';
import { incrementFlag } from './items.repository.js';

export class ItemError extends Error {
  constructor(readonly reason: 'not_found') {
    super(reason);
    this.name = 'ItemError';
  }
}

export interface FlagResult {
  /** Whether this report took the item out of circulation. */
  retired: boolean;
}

/**
 * Reporting a bad question (T-029).
 *
 * The count is shared with `pnpm qa:retire`, which sets it straight to the
 * threshold: a question the founder rejected during content QA and one three
 * learners reported are then excluded by exactly the same rule, in the same
 * `flagged_bad < 3` predicate the due query and the day-30 test already use.
 * That was the reason retirement rode on this column rather than a new one.
 *
 * **The count is not deduplicated per learner**, and with ten pilot participants
 * that is the right trade. Reporting the same question three times means seeing
 * it three times, days apart, and someone who does that is telling us something
 * real. Deduplicating needs a table of who-flagged-what, which is a schema task
 * — and at pilot scale it would buy nothing. Revisit before opening the pilot up.
 */
export async function flagItem(itemId: string): Promise<FlagResult> {
  const updated = await incrementFlag(itemId);
  if (!updated) throw new ItemError('not_found');

  return { retired: updated.flaggedBad >= RETIRED_FLAG_THRESHOLD };
}
