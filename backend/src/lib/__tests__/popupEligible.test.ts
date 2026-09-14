import { describe, expect, it } from 'vitest';
import { ANSWER_BLOCK_KINDS } from '@learnos/shared';
import {
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

  it('refuses the format that cannot be answered in twenty seconds', () => {
    expect(isPanelEligible('codeEditor')).toBe(false); // two to four minutes
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

  it('refuses a code editor on every surface', () => {
    // Four minutes is worth paying once, when writing the thing is the point.
    // Paying it again for an answer already given is how a queue gets abandoned.
    expect(isReviewEligible('codeEditor')).toBe(false);
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
