import { describe, expect, it } from 'vitest';
import { nextSighting } from '../nextSighting';

const now = new Date(2026, 8, 6, 14, 0, 0); // 6 Sep 2026, 2pm local

describe('nextSighting', () => {
  it('says tomorrow when the card is due tomorrow', () => {
    expect(nextSighting(new Date(2026, 8, 7, 9, 0, 0).toISOString(), now)).toBe(
      'You’ll see this one again tomorrow.',
    );
  });

  it('says later today for a lapse on a learning step', () => {
    // The common case for a wrong answer, and the one the design canvas's flat
    // "tomorrow" gets wrong: FSRS often brings a lapsed card back in minutes.
    expect(nextSighting(new Date(2026, 8, 6, 14, 20, 0).toISOString(), now)).toBe(
      'You’ll see this one again later today.',
    );
  });

  it('counts calendar days, not elapsed hours', () => {
    // Due in 20 hours, but on the day after tomorrow. "Tomorrow" is a date.
    expect(nextSighting(new Date(2026, 8, 9, 10, 0, 0).toISOString(), now)).toBe(
      'You’ll see this one again in 3 days.',
    );
  });

  it('promises nothing when nothing was scheduled', () => {
    // A snooze or a dismissal moves no schedule, so there is no return date to
    // promise and the line is not shown at all.
    expect(nextSighting(null, now)).toBeNull();
  });

  it('promises nothing on an unparseable date rather than inventing one', () => {
    expect(nextSighting('soon', now)).toBeNull();
  });
});
