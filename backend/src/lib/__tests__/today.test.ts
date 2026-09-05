import { describe, expect, it } from 'vitest';
import { localDay, localDayFor } from '../today.js';

/** An instant expressed as a wall clock in a given zone, so the tests read the
 *  way the scenario does rather than as a UTC offset puzzle. */
const at = (iso: string) => new Date(iso);

describe('localDay', () => {
  it('splits either side of local midnight in Asia/Kolkata', () => {
    // 23:30 IST on the 5th is 18:00Z on the 5th; 00:10 IST on the 6th is 18:40Z
    // on the 5th — the same UTC date, deliberately.
    const before = localDay(at('2026-09-05T18:00:00Z'), 'Asia/Kolkata');
    const after = localDay(at('2026-09-05T18:40:00Z'), 'Asia/Kolkata');

    expect(before).toBe('2026-09-05');
    expect(after).toBe('2026-09-06');
    expect(before).not.toBe(after);
  });

  it('keeps one local date for two instants within the same local day', () => {
    // 00:10 IST and 23:30 IST on 2026-09-06.
    const early = localDay(at('2026-09-05T18:40:00Z'), 'Asia/Kolkata');
    const late = localDay(at('2026-09-06T18:00:00Z'), 'Asia/Kolkata');
    expect(early).toBe(late);
  });

  it('produces 24 distinct dates across a DST boundary in America/Los_Angeles', () => {
    // 2026-11-01 is the US fall-back. Sampling at 12:00 local avoids the
    // ambiguous hour while still crossing the transition.
    const days = new Set<string>();
    for (let i = 0; i < 24; i += 1) {
      const d = new Date(Date.UTC(2026, 9, 22, 20, 0, 0));
      d.setUTCDate(d.getUTCDate() + i);
      days.add(localDay(d, 'America/Los_Angeles'));
    }
    // No day doubled and none skipped — a naive fixed-offset implementation
    // produces 23 or 25 here.
    expect(days.size).toBe(24);
  });

  it('does not depend on the server’s own timezone', () => {
    const instant = at('2026-09-05T18:40:00Z');
    const original = process.env.TZ;
    try {
      process.env.TZ = 'UTC';
      const fromUtc = localDay(instant, 'Asia/Kolkata');
      process.env.TZ = 'Asia/Tokyo';
      const fromTokyo = localDay(instant, 'Asia/Kolkata');
      expect(fromUtc).toBe(fromTokyo);
      expect(fromUtc).toBe('2026-09-06');
    } finally {
      process.env.TZ = original;
    }
  });

  it('zero-pads so the value sorts and compares as a string', () => {
    expect(localDay(at('2026-01-02T12:00:00Z'), 'UTC')).toBe('2026-01-02');
  });

  it('throws on an unknown timezone rather than silently using UTC', () => {
    expect(() => localDay(at('2026-09-05T00:00:00Z'), 'Mars/Olympus')).toThrow(/timezone/);
  });

  it('falls back to UTC for a user who has not set one yet', () => {
    expect(localDayFor(at('2026-09-05T23:00:00Z'), null)).toBe('2026-09-05');
  });
});
