import { RETIRED_FLAG_THRESHOLD } from '../../lib/retire.js';
import { ItemPayloadSchema } from '@learnos/shared';
import { findItemPayload, incrementFlag } from './items.repository.js';

export class ItemError extends Error {
  constructor(readonly reason: 'not_found' | 'no_skeleton') {
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

/**
 * "Show me the shape" (T-088).
 *
 * Fetched rather than shipped with the item, because the skeleton is most of
 * the answer: the function's structure with the bodies blank. Sending it in the
 * payload would hand it to every learner for free, including the ones who never
 * asked — and `assisted` would then be measuring who clicked a button rather
 * than who needed help.
 *
 * Taking it is not recorded here. The client sends `assisted: true` with the
 * answer, which is the row that matters — a learner who reveals the skeleton
 * and then closes the tab has not answered anything.
 */
export async function getSkeleton(itemId: string): Promise<{ skeleton: string }> {
  const raw = await findItemPayload(itemId);
  if (!raw) throw new ItemError('not_found');

  const parsed = ItemPayloadSchema.safeParse(raw);
  const block = parsed.success
    ? parsed.data.blocks?.find((b) => b.kind === 'codeEditor' && b.slot === 'answer')
    : undefined;

  if (!block || block.kind !== 'codeEditor') throw new ItemError('no_skeleton');
  return { skeleton: block.skeleton };
}
