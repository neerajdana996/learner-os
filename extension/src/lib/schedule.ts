import type { MeResponse } from '@learnos/shared';

/**
 * When may the extension interrupt someone? (T-028)
 *
 * Pure on purpose. This is the rule that decides whether a person gets poked,
 * and getting it wrong is the fastest way to lose a pilot participant — three
 * cards in five minutes, or one at 2am, and they uninstall. A pure function
 * over an explicit state is something every edge case can be a unit test of,
 * which is not true of anything reading `chrome.alarms` directly.
 *
 * The service worker is killed between alarms and keeps nothing in memory, so
 * all of the state below lives in `chrome.storage.local` and arrives here as an
 * argument.
 */

/** Minimum gap between two cards. Twelve a day inside a few hours of windows is
 *  already frequent; anything tighter reads as harassment rather than practice. */
export const MIN_GAP_MS = 20 * 60 * 1000;

/** Matches `UserProfileSchema.dailyCap`. Only used when `/me` has not been
 *  fetched yet — the server's number always wins. */
export const DEFAULT_DAILY_CAP = 12;

/** Three refusals in a row means "not today", and we believe them (plan.md §4). */
export const DISMISSALS_BEFORE_BACKOFF = 3;

export interface PopState {
  /** The user-local day (`YYYY-MM-DD`) the counters below belong to. Counters
   *  reset when the local day changes, not on a rolling 24 hours. */
  day: string | null;
  dailyCount: number;
  /** Epoch ms. */
  lastShownAt: number | null;
  consecutiveDismissals: number;
  /** Epoch ms. Set when the learner waves three cards away in a row. */
  backoffUntil: number | null;
}

export const EMPTY_STATE: PopState = {
  day: null,
  dailyCount: 0,
  lastShownAt: null,
  consecutiveDismissals: 0,
  backoffUntil: null,
};

export type PopReason =
  | 'idle'
  | 'backoff'
  | 'outside_window'
  | 'cap_reached'
  | 'too_soon';

export type PopDecision = { show: true } | { show: false; reason: PopReason };

/**
 * The user-local calendar day, `YYYY-MM-DD`.
 *
 * `en-CA` because it formats as ISO; `Intl` because the worker has no other way
 * to resolve a timezone, and the counters must roll over at the learner's
 * midnight rather than UTC's.
 */
export function localDay(now: Date, timezone: string | null): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone ?? undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * The user-local wall clock, `HH:MM`.
 *
 * `h23` rather than the default: `hour12: false` still renders midnight as
 * "24" in some locales, which would sort after every window's end and make the
 * small hours look like they were inside one.
 */
export function localHHMM(now: Date, timezone: string | null): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone ?? undefined,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);
}

/** Windows never cross midnight (`ActiveWindowsSchema`), so a plain string
 *  comparison is correct and there is no wraparound case to get wrong. */
export function insideWindow(hhmm: string, windows: MeResponse['activeWindows']): boolean {
  return windows.some((w) => hhmm >= w.start && hhmm < w.end);
}

/**
 * Counters belong to a local day. Call this before reading `dailyCount`, or a
 * learner who hit the cap yesterday gets nothing today.
 */
export function rollOver(state: PopState, now: Date, timezone: string | null): PopState {
  const today = localDay(now, timezone);
  if (state.day === today) return state;
  // Deliberately keeps `backoffUntil`: a backoff that runs past midnight was
  // set because someone waved three cards away, and the new day does not undo
  // that. `consecutiveDismissals` resets with the count it belongs to.
  return { ...state, day: today, dailyCount: 0, consecutiveDismissals: 0 };
}

export interface PopInputs {
  state: PopState;
  now: Date;
  me: Pick<MeResponse, 'timezone' | 'activeWindows' | 'profile'>;
  /** From `chrome.idle`. Someone away from the keyboard cannot answer, and a
   *  card shown to an empty chair burns the daily cap for nothing. */
  idle: boolean;
}

/**
 * The whole rule, in the order a refusal is most likely.
 *
 * Order matters only for which `reason` comes back, and the reasons exist so
 * the worker's log says *why* nothing popped — "nothing due" and "outside your
 * windows" are very different bugs to chase.
 */
export function shouldShow({ state, now, me, idle }: PopInputs): PopDecision {
  if (idle) return { show: false, reason: 'idle' };

  const at = now.getTime();
  if (state.backoffUntil !== null && state.backoffUntil > at) {
    return { show: false, reason: 'backoff' };
  }

  const today = rollOver(state, now, me.timezone);

  if (!insideWindow(localHHMM(now, me.timezone), me.activeWindows)) {
    return { show: false, reason: 'outside_window' };
  }

  const cap = me.profile.dailyCap ?? DEFAULT_DAILY_CAP;
  if (today.dailyCount >= cap) return { show: false, reason: 'cap_reached' };

  if (today.lastShownAt !== null && at - today.lastShownAt < MIN_GAP_MS) {
    return { show: false, reason: 'too_soon' };
  }

  return { show: true };
}

/** After a card is put in front of someone. */
export function recordShown(state: PopState, now: Date, timezone: string | null): PopState {
  const today = rollOver(state, now, timezone);
  return { ...today, dailyCount: today.dailyCount + 1, lastShownAt: now.getTime() };
}

/** Answered, or explicitly finished — the run of refusals is broken. */
export function recordAnswered(state: PopState): PopState {
  return { ...state, consecutiveDismissals: 0, backoffUntil: null };
}

/**
 * Waved away. Three in a row and the extension stops for the rest of the local
 * day: someone declining repeatedly is telling us something, and the product
 * that keeps asking anyway is the one they uninstall.
 */
export function recordDismissed(
  state: PopState,
  now: Date,
  timezone: string | null,
): PopState {
  const dismissals = state.consecutiveDismissals + 1;
  if (dismissals < DISMISSALS_BEFORE_BACKOFF) {
    return { ...state, consecutiveDismissals: dismissals };
  }
  // Until the learner's own midnight, not "+24h": backing off until 3pm
  // tomorrow because they declined at 3pm today would silently eat a day.
  const endOfDay = new Date(now);
  const [h, m] = localHHMM(now, timezone).split(':').map(Number);
  const minutesLeft = (23 - (h ?? 0)) * 60 + (60 - (m ?? 0));
  endOfDay.setTime(now.getTime() + minutesLeft * 60_000);

  return { ...state, consecutiveDismissals: dismissals, backoffUntil: endOfDay.getTime() };
}
