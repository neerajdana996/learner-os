import { describe, expect, it } from 'vitest';
import { effectiveAt, MAX_BACKDATE_MS } from '../recordReview.js';

const now = new Date('2026-09-06T12:00:00.000Z');

describe('effectiveAt', () => {
  it('uses the server clock when nothing is claimed', () => {
    expect(effectiveAt(undefined, now)).toEqual(now);
  });

  it('honours a backdated answer from the offline queue', () => {
    // The point of the whole mechanism: a Tuesday answer synced on Friday must
    // be recorded on Tuesday, or gapDaysSinceLast is inflated by three days —
    // and that gap is what the pilot measures.
    const tuesday = '2026-09-01T09:30:00.000Z';
    expect(effectiveAt(tuesday, now).toISOString()).toBe(tuesday);
  });

  it('refuses a backdate beyond the window a real queue could span', () => {
    // Unlike `assisted`, a backdate flatters the learner — a longer gap makes
    // retention look better — so it is clamped rather than believed.
    const ancient = new Date(now.getTime() - MAX_BACKDATE_MS - 60_000).toISOString();
    expect(effectiveAt(ancient, now).getTime()).toBe(now.getTime() - MAX_BACKDATE_MS);
  });

  it('collapses a future stamp to now', () => {
    // A device with a wrong clock is common, and an answer from the future
    // would produce a negative gap.
    expect(effectiveAt('2027-01-01T00:00:00.000Z', now)).toEqual(now);
  });

  it('falls back to now on an unparseable stamp', () => {
    expect(effectiveAt('yesterday-ish', now)).toEqual(now);
  });

  it('accepts the exact edge of the window', () => {
    const edge = new Date(now.getTime() - MAX_BACKDATE_MS).toISOString();
    expect(effectiveAt(edge, now).toISOString()).toBe(edge);
  });
});
