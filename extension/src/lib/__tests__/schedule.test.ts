import { describe, expect, it } from 'vitest';
import {
  DISMISSALS_BEFORE_BACKOFF,
  EMPTY_STATE,
  insideWindow,
  localDay,
  localHHMM,
  MIN_GAP_MS,
  recordAnswered,
  recordDismissed,
  recordShown,
  rollOver,
  shouldShow,
  type PopState,
} from '../schedule';

const TZ = 'Asia/Kolkata';

const me = {
  timezone: TZ,
  activeWindows: [{ start: '09:00', end: '18:00' }],
  profile: { dailyCap: 12, calibrationGap: null },
};

/** 14:00 in Asia/Kolkata (UTC+5:30) — the middle of the window. */
const inside = new Date('2026-09-06T08:30:00Z');
/** 03:00 in Asia/Kolkata — the small hours. */
const outside = new Date('2026-09-05T21:30:00Z');

function state(over: Partial<PopState> = {}): PopState {
  return { ...EMPTY_STATE, day: localDay(inside, TZ), ...over };
}

describe('local time', () => {
  it('resolves the day in the learner’s timezone, not UTC', () => {
    // 21:30 UTC on the 5th is already the 6th in Kolkata.
    expect(localDay(outside, TZ)).toBe('2026-09-06');
    expect(localDay(outside, 'UTC')).toBe('2026-09-05');
  });

  it('renders midnight as 00:00, never 24:00', () => {
    // 18:30 UTC is exactly midnight in Kolkata. Rendered as "24:00" it would
    // sort after every window end and read as inside the evening window.
    expect(localHHMM(new Date('2026-09-05T18:30:00Z'), TZ)).toBe('00:00');
  });
});

describe('insideWindow', () => {
  const windows = [
    { start: '09:00', end: '12:00' },
    { start: '14:00', end: '18:00' },
  ];

  it('is inside at the start and outside at the end', () => {
    expect(insideWindow('09:00', windows)).toBe(true);
    // Half-open: 12:00 belongs to the gap, not the morning. Otherwise two
    // adjacent windows would both claim the boundary minute.
    expect(insideWindow('12:00', windows)).toBe(false);
    expect(insideWindow('11:59', windows)).toBe(true);
  });

  it('is outside between windows and with no windows at all', () => {
    expect(insideWindow('13:00', windows)).toBe(false);
    expect(insideWindow('11:00', [])).toBe(false);
  });
});

describe('shouldShow', () => {
  it('shows inside a window with a fresh state', () => {
    expect(shouldShow({ state: state(), now: inside, me, idle: false })).toEqual({ show: true });
  });

  it('refuses outside the windows', () => {
    expect(shouldShow({ state: state(), now: outside, me, idle: false })).toEqual({
      show: false,
      reason: 'outside_window',
    });
  });

  it('refuses once the daily cap is reached', () => {
    expect(shouldShow({ state: state({ dailyCount: 12 }), now: inside, me, idle: false })).toEqual({
      show: false,
      reason: 'cap_reached',
    });
  });

  it('refuses fifteen minutes after the last card, and allows twenty-one', () => {
    const fifteen = state({ dailyCount: 1, lastShownAt: inside.getTime() - 15 * 60_000 });
    expect(shouldShow({ state: fifteen, now: inside, me, idle: false })).toEqual({
      show: false,
      reason: 'too_soon',
    });

    const twentyOne = state({ dailyCount: 1, lastShownAt: inside.getTime() - 21 * 60_000 });
    expect(shouldShow({ state: twentyOne, now: inside, me, idle: false })).toEqual({ show: true });
  });

  it('refuses while a backoff is running', () => {
    const backed = state({ backoffUntil: inside.getTime() + 60_000 });
    expect(shouldShow({ state: backed, now: inside, me, idle: false })).toEqual({
      show: false,
      reason: 'backoff',
    });
  });

  it('shows again once the backoff has expired', () => {
    const expired = state({ backoffUntil: inside.getTime() - 1 });
    expect(shouldShow({ state: expired, now: inside, me, idle: false })).toEqual({ show: true });
  });

  it('refuses when the learner is away from the keyboard', () => {
    // A card shown to an empty chair spends the daily cap and teaches nothing.
    expect(shouldShow({ state: state(), now: inside, me, idle: true })).toEqual({
      show: false,
      reason: 'idle',
    });
  });

  it('starts a new local day with the count reset', () => {
    // Capped out yesterday; today should be allowed without any explicit reset.
    const yesterday = state({ day: '2026-09-05', dailyCount: 12, lastShownAt: null });
    expect(shouldShow({ state: yesterday, now: inside, me, idle: false })).toEqual({ show: true });
  });

  it('falls back to the default cap when the profile has none', () => {
    const noCap = { ...me, profile: { calibrationGap: null } } as typeof me;
    const atDefault = state({ dailyCount: 12 });
    expect(shouldShow({ state: atDefault, now: inside, me: noCap, idle: false })).toEqual({
      show: false,
      reason: 'cap_reached',
    });
  });
});

describe('rollOver', () => {
  it('keeps a running backoff across midnight', () => {
    // The backoff was set because someone waved three cards away. A new day
    // does not undo that; the count it belongs to does reset.
    const yesterday = state({ day: '2026-09-05', dailyCount: 9, backoffUntil: 1, consecutiveDismissals: 3 });
    const rolled = rollOver(yesterday, inside, TZ);

    expect(rolled).toMatchObject({ day: '2026-09-06', dailyCount: 0, consecutiveDismissals: 0, backoffUntil: 1 });
  });

  it('is a no-op within the same day', () => {
    const today = state({ dailyCount: 3 });
    expect(rollOver(today, inside, TZ)).toBe(today);
  });
});

describe('recording outcomes', () => {
  it('counts a shown card and stamps the time', () => {
    const after = recordShown(state(), inside, TZ);
    expect(after.dailyCount).toBe(1);
    expect(after.lastShownAt).toBe(inside.getTime());
    // And the next alarm twenty minutes later is refused.
    const soon = new Date(inside.getTime() + MIN_GAP_MS - 1);
    expect(shouldShow({ state: after, now: soon, me, idle: false })).toMatchObject({ reason: 'too_soon' });
  });

  it('an answer clears the run of refusals and any backoff', () => {
    const cross = state({ consecutiveDismissals: 2, backoffUntil: inside.getTime() + 1000 });
    expect(recordAnswered(cross)).toMatchObject({ consecutiveDismissals: 0, backoffUntil: null });
  });

  it('backs off only on the third dismissal in a row', () => {
    let s = state();
    for (let i = 1; i < DISMISSALS_BEFORE_BACKOFF; i += 1) {
      s = recordDismissed(s, inside, TZ);
      expect(s.backoffUntil).toBeNull();
    }

    s = recordDismissed(s, inside, TZ);
    expect(s.consecutiveDismissals).toBe(DISMISSALS_BEFORE_BACKOFF);
    expect(s.backoffUntil).not.toBeNull();
    expect(shouldShow({ state: s, now: inside, me, idle: false })).toMatchObject({ reason: 'backoff' });
  });

  it('backs off until the learner’s own midnight, not a rolling 24 hours', () => {
    let s = state();
    for (let i = 0; i < DISMISSALS_BEFORE_BACKOFF; i += 1) s = recordDismissed(s, inside, TZ);

    // Declining at 14:00 must not silence tomorrow afternoon as well: the
    // backoff ends at the learner's next midnight, ten hours later, not in
    // twenty-four. Midnight belongs to the new day, which is the point.
    const until = new Date(s.backoffUntil ?? 0);
    expect(localHHMM(until, TZ)).toBe('00:00');
    expect(localDay(until, TZ)).toBe('2026-09-07');
    expect(s.backoffUntil).toBeLessThan(inside.getTime() + 24 * 60 * 60_000);
  });
});
