import { inArray, isNull, not, or, type SQL } from 'drizzle-orm';
import { ANSWER_BLOCK_KINDS, type AnswerBlockKind } from '@learnos/shared';
import { items } from '../db/schema.js';

/**
 * What may be asked on a small, timed surface (T-089).
 *
 * The extension popup is 380×300 and the promise on the card is twenty seconds.
 * An item that cannot be answered in that space is not a slightly worse card —
 * it is a card that gets dismissed, and three dismissals in a row stop the
 * extension for the day (`lib/schedule.ts`). One badly chosen item therefore
 * costs the rest of the day's retrieval, which is the thing being measured.
 *
 * The concept is not skipped: it stays due and comes up in the next web
 * session instead. This decides *where* a question is asked, never whether.
 *
 * **The Day-30 test uses the same rule** (T-093). Three `codeEditor` items in a
 * 25-item surprise test is twelve minutes of it, and a learner who abandons the
 * test produces no Day-30 number at all — which is the pilot's entire output.
 * One predicate, applied in the repository, so the two surfaces cannot drift.
 */

/**
 * Answer formats too slow or too large for a popup.
 *
 * `codeEditor` is two to four minutes by design. `orderLines` is 25–45s of
 * drag-and-drop, which needs a pointer and room to drop.
 *
 * `clozeCode` and `hotspotLine` are deliberately **not** here: 15–30s and
 * 8–15s, one tap or one short blank, which is exactly what the card is for.
 */
export const POPUP_INELIGIBLE_KINDS = ['codeEditor', 'orderLines'] as const satisfies readonly AnswerBlockKind[];

/**
 * Everything else, including anything added later.
 *
 * Derived rather than listed so a new answer format is popup-*eligible* by
 * default and has to be excluded on purpose. The opposite default fails
 * silently: `graphBuild` (T-108) would simply never appear on the extension and
 * nobody would notice, because "no card right now" is also what a quiet day
 * looks like.
 */
export const POPUP_ELIGIBLE_KINDS: readonly AnswerBlockKind[] = ANSWER_BLOCK_KINDS.filter(
  (kind): kind is AnswerBlockKind => !(POPUP_INELIGIBLE_KINDS as readonly string[]).includes(kind),
);

/** For a row already loaded. A null `answerKind` is a plain prompt — every item
 *  generated before blocks existed — and must stay eligible, or the extension
 *  goes quiet for every existing topic. */
export function isPopupEligible(answerKind: string | null): boolean {
  if (answerKind === null) return true;
  return !(POPUP_INELIGIBLE_KINDS as readonly string[]).includes(answerKind);
}

/** SQL: the same rule, for the query that picks a due item. */
export function popupEligible(): SQL | undefined {
  return or(isNull(items.answerKind), not(inArray(items.answerKind, [...POPUP_INELIGIBLE_KINDS])));
}
