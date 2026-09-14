import { inArray, isNull, not, or, type SQL } from 'drizzle-orm';
import { ANSWER_BLOCK_KINDS, type AnswerBlockKind } from '@learnos/shared';
import { items } from '../db/schema.js';

/**
 * What each surface may ask (T-089, T-093; revised T-170).
 *
 * The promise on a card is about twenty seconds. An item that cannot be
 * answered in that time is not a slightly worse card — it is a card that gets
 * dismissed, and three dismissals in a row stop the extension for the day
 * (`lib/schedule.ts`). One badly chosen item costs the rest of that day's
 * retrieval, which is the thing being measured.
 *
 * The concept is never skipped: it stays due and comes up in the next web
 * session instead. This decides *where* a question is asked, never whether.
 */

/**
 * Answer formats the extension's side panel may not ask.
 *
 * **`orderLines` was here and is not any more (T-170).** It was excluded for
 * being "25–45s of drag-and-drop, which needs a pointer and room to drop", and
 * both halves of that stopped being true. The panel replaced a 380×300 popup,
 * so the room exists; and `OrderLines` has never actually dragged — T-114 built
 * it with up/down buttons on purpose, because HTML5 drag does not fire on touch
 * at all and is invisible to a screen reader, with each control clearing a 44px
 * tap target for exactly this surface. The exclusion outlived its reason.
 *
 * What it costs is time — 25–45s against a ~20s promise — which is a real
 * trade and a founder's call, not a technical bar.
 *
 * **`codeEditor` stays**, and is excluded twice over: `REVIEW_INELIGIBLE_KINDS`
 * below bars it from every review queue on any surface (T-088), so removing it
 * from this list alone would change nothing. It is two to four minutes.
 *
 * `clozeCode` and `hotspotLine` were never here: 15–30s and 8–15s, one tap or
 * one short blank, which is exactly what a card is for.
 */
export const PANEL_INELIGIBLE_KINDS = ['codeEditor'] as const satisfies readonly AnswerBlockKind[];

/**
 * The Day-30 cold test keeps the stricter list (T-093).
 *
 * **These were one constant until T-170, and that was a trap.** The extension
 * and the cold test are different promises: the panel asks one question and the
 * learner can close it, while the test is twenty-five questions in one sitting
 * and a learner who abandons it produces no Day-30 number at all — which is the
 * pilot's entire output. Three `codeEditor` items there is twelve minutes of a
 * twenty-five minute test.
 *
 * So `orderLines` returning to the panel must not return to the test, and one
 * shared list would have made that impossible to say.
 */
export const COLD_TEST_INELIGIBLE_KINDS = ['codeEditor', 'orderLines'] as const satisfies readonly AnswerBlockKind[];

/**
 * Everything else, including anything added later.
 *
 * Derived rather than listed so a new answer format is popup-*eligible* by
 * default and has to be excluded on purpose. The opposite default fails
 * silently: `graphBuild` (T-108) would simply never appear on the extension and
 * nobody would notice, because "no card right now" is also what a quiet day
 * looks like.
 */
export const PANEL_ELIGIBLE_KINDS: readonly AnswerBlockKind[] = ANSWER_BLOCK_KINDS.filter(
  (kind): kind is AnswerBlockKind => !(PANEL_INELIGIBLE_KINDS as readonly string[]).includes(kind),
);

/** For a row already loaded. A null `answerKind` is a plain prompt — every item
 *  generated before blocks existed — and must stay eligible, or the extension
 *  goes quiet for every existing topic. */
export function isPanelEligible(answerKind: string | null): boolean {
  if (answerKind === null) return true;
  return !(PANEL_INELIGIBLE_KINDS as readonly string[]).includes(answerKind);
}

/** The same shape, for the cold test's stricter list. */
export function isColdTestEligible(answerKind: string | null): boolean {
  if (answerKind === null) return true;
  return !(COLD_TEST_INELIGIBLE_KINDS as readonly string[]).includes(answerKind);
}

/** SQL: the same rule, for the query that picks a due item. */
export function panelEligible(): SQL | undefined {
  return or(isNull(items.answerKind), not(inArray(items.answerKind, [...PANEL_INELIGIBLE_KINDS])));
}

/** SQL: the cold test's stricter list. */
export function coldTestEligible(): SQL | undefined {
  return or(isNull(items.answerKind), not(inArray(items.answerKind, [...COLD_TEST_INELIGIBLE_KINDS])));
}

/**
 * Formats that may never be a **review**, on any surface (T-088).
 *
 * A `codeEditor` is two to four minutes. It earns that once, when a concept is
 * newly taught and writing the thing is the point. As a review it is the same
 * four minutes for a question the learner has already answered, several times,
 * against a ten-minute daily budget — which is how a review queue becomes a
 * thing people stop opening.
 *
 * This also satisfies T-088's other acceptance line — "the same concept's next
 * review is a `clozeCode`, not this" — without the item picker needing to
 * remember what it served last: if the format can never be a review, the next
 * review is necessarily something else.
 */
export const REVIEW_INELIGIBLE_KINDS = ['codeEditor'] as const satisfies readonly AnswerBlockKind[];

/** For a row already loaded. Null is a plain prompt and always eligible. */
export function isReviewEligible(answerKind: string | null): boolean {
  if (answerKind === null) return true;
  return !(REVIEW_INELIGIBLE_KINDS as readonly string[]).includes(answerKind);
}

/** SQL: the same rule, for the query that picks a due item. */
export function reviewEligible(): SQL | undefined {
  return or(isNull(items.answerKind), not(inArray(items.answerKind, [...REVIEW_INELIGIBLE_KINDS])));
}
