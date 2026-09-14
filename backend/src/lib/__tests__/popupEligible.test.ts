import { describe, expect, it } from 'vitest';
import { ANSWER_BLOCK_KINDS } from '@learnos/shared';
import {
  coldTestEligible,
  panelEligible,
  reviewEligible,
  isColdTestEligible,
  isPanelEligible,
  isReviewEligible,
  PANEL_ELIGIBLE_KINDS,
  PANEL_INELIGIBLE_KINDS,
  REVIEW_INELIGIBLE_KINDS,
} from '../popupEligible.js';

describe('isPanelEligible', () => {
  it('keeps a plain item, which is every item generated before blocks existed', () => {
    // A null answer_kind must stay eligible or the extension goes quiet for
    // every existing topic.
    expect(isPanelEligible(null)).toBe(true);
  });

  /**
   * T-171 (founder decision 2026-09-14). This test used to assert the opposite.
   * The panel stays open while the learner writes, the extension runs the code
   * through a sandbox page, and non-JavaScript answers are judged on the server
   * — so the reasons for refusing it are gone.
   */
  it('allows codeEditor, now that the panel can run and grade it', () => {
    expect(isPanelEligible('codeEditor')).toBe(true);
    // The cold test is a different promise, and still refuses it.
    expect(isColdTestEligible('codeEditor')).toBe(false);
  });

  /**
   * `orderLines` was refused for being "a drag that needs a pointer and room to
   * drop" (T-089) and both halves stopped being true (T-170): the side panel
   * replaced a 380×300 popup, and `OrderLines` has never dragged — T-114 built
   * it with up/down buttons because HTML5 drag does not fire on touch at all,
   * each clearing a 44px tap target for exactly this surface.
   */
  it('allows orderLines, whose exclusion outlived its reason', () => {
    expect(isPanelEligible('orderLines')).toBe(true);
    // Still refused by the cold test, which is a different promise entirely.
    expect(isColdTestEligible('orderLines')).toBe(false);
  });

  it('allows the cheap ones', () => {
    expect(isPanelEligible('clozeCode')).toBe(true); // 15–30s, one short blank
    expect(isPanelEligible('hotspotLine')).toBe(true); // 8–15s, one tap
  });

  it('accounts for every answer kind exactly once', () => {
    // If a new format is added and nobody classifies it, this fails loudly here
    // rather than silently on someone's popup.
    expect([...PANEL_ELIGIBLE_KINDS, ...PANEL_INELIGIBLE_KINDS].sort()).toEqual(
      [...ANSWER_BLOCK_KINDS].sort(),
    );
  });

  it('makes a newly added format eligible by default', () => {
    // The opposite default fails silently: graphBuild (T-108) would simply never
    // appear on the extension, and "no card right now" is also what a quiet day
    // looks like — so nobody would notice for weeks.
    expect(isPanelEligible('somethingAddedLater')).toBe(true);
  });
});

describe('isReviewEligible', () => {
  it('keeps a plain item', () => {
    expect(isReviewEligible(null)).toBe(true);
  });

  /** T-171: used to assert the opposite. Reviews on both surfaces now; the
   *  cost is bounded by `rationItems` and by the cold test's own list. */
  it('lets a code editor be a review, on every surface', () => {
    expect(isReviewEligible('codeEditor')).toBe(true);
  });

  it('leaves the cheap code formats reviewable', () => {
    // This is what T-088's "the next review is a clozeCode, not this" means in
    // practice — no memory of what was served last is needed.
    expect(isReviewEligible('clozeCode')).toBe(true);
    expect(isReviewEligible('hotspotLine')).toBe(true);
    expect(isReviewEligible('orderLines')).toBe(true);
  });

  it('is not stricter than the popup rule', () => {
    // A review runs on both surfaces, so anything barred from review must also
    // be barred from the popup — never the reverse.
    for (const kind of REVIEW_INELIGIBLE_KINDS) {
      expect(isPanelEligible(kind)).toBe(false);
    }
  });

  it('makes a newly added format reviewable by default', () => {
    expect(isReviewEligible('somethingAddedLater')).toBe(true);
  });
});

describe('the SQL form', () => {
  /** An empty exclusion list must be *no* condition, never `NOT IN ()` — which
   *  is a syntax error in Postgres and would take `/due` down with it. */
  it('adds no condition when nothing is excluded', () => {
    expect(PANEL_INELIGIBLE_KINDS).toHaveLength(0);
    expect(REVIEW_INELIGIBLE_KINDS).toHaveLength(0);
    expect(panelEligible()).toBeUndefined();
    expect(reviewEligible()).toBeUndefined();
  });

  it('still filters the cold test, whose list is not empty', () => {
    expect(coldTestEligible()).toBeDefined();
  });
});
