import { describe, expect, it } from 'vitest';
import { ANSWER_BLOCK_KINDS } from '@learnos/shared';
import {
  isPopupEligible,
  POPUP_ELIGIBLE_KINDS,
  POPUP_INELIGIBLE_KINDS,
} from '../popupEligible.js';

describe('isPopupEligible', () => {
  it('keeps a plain item, which is every item generated before blocks existed', () => {
    // A null answer_kind must stay eligible or the extension goes quiet for
    // every existing topic.
    expect(isPopupEligible(null)).toBe(true);
  });

  it('refuses the formats that cannot be answered in twenty seconds', () => {
    expect(isPopupEligible('codeEditor')).toBe(false); // two to four minutes
    expect(isPopupEligible('orderLines')).toBe(false); // 25–45s of drag and drop
  });

  it('allows the cheap ones', () => {
    expect(isPopupEligible('clozeCode')).toBe(true); // 15–30s, one short blank
    expect(isPopupEligible('hotspotLine')).toBe(true); // 8–15s, one tap
  });

  it('accounts for every answer kind exactly once', () => {
    // If a new format is added and nobody classifies it, this fails loudly here
    // rather than silently on someone's popup.
    expect([...POPUP_ELIGIBLE_KINDS, ...POPUP_INELIGIBLE_KINDS].sort()).toEqual(
      [...ANSWER_BLOCK_KINDS].sort(),
    );
  });

  it('makes a newly added format eligible by default', () => {
    // The opposite default fails silently: graphBuild (T-108) would simply never
    // appear on the extension, and "no card right now" is also what a quiet day
    // looks like — so nobody would notice for weeks.
    expect(isPopupEligible('somethingAddedLater')).toBe(true);
  });
});
