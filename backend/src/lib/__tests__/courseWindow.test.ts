import { describe, expect, it } from 'vitest';
import { isTeaching } from '../courseWindow.js';

const DAY = 86_400_000;
const now = new Date('2026-09-06T10:00:00Z');

function topic(over: Partial<{ status: string | null; endsAt: Date | null }> = {}) {
  return { status: 'active', endsAt: new Date(now.getTime() + DAY), ...over };
}

describe('isTeaching', () => {
  it('is teaching inside the window', () => {
    expect(isTeaching(topic(), now)).toBe(true);
  });

  /**
   * The one that matters. Days 8–29 are silent by design (plan.md §2): if
   * reviews keep arriving, the day-30 test is not a cold test and the pilot's
   * only number stops meaning anything. Nothing else notices `endsAt` passing —
   * `status` stays 'active' forever, because nothing ever writes 'done'.
   */
  it('stops teaching once endsAt has passed', () => {
    expect(isTeaching(topic({ endsAt: new Date(now.getTime() - 1) }), now)).toBe(false);
  });

  it('stops teaching exactly at endsAt, not a moment after', () => {
    expect(isTeaching(topic({ endsAt: now }), now)).toBe(false);
  });

  it('keeps teaching a topic with no end date — the demo topic has no deadline to be past', () => {
    expect(isTeaching(topic({ endsAt: null }), now)).toBe(true);
  });

  it('is not teaching while a topic is still generating, or has failed', () => {
    expect(isTeaching(topic({ status: 'generating' }), now)).toBe(false);
    expect(isTeaching(topic({ status: 'failed' }), now)).toBe(false);
    expect(isTeaching(topic({ status: 'done' }), now)).toBe(false);
    expect(isTeaching(topic({ status: null }), now)).toBe(false);
  });
});
