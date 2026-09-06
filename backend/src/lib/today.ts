import { isValidTimeZone } from '../shared/index.js';

/**
 * "Today" in the product is always the learner's today, never the server's
 * (T-023). A learner in Asia/Kolkata finishing at 00:10 has started a new day
 * even though it is still yesterday in UTC.
 *
 * Returns `YYYY-MM-DD`. It stays a string end to end — `session_days.day` is a
 * `date` column in string mode — because round-tripping through a JS `Date`
 * reintroduces exactly the UTC-versus-local confusion this exists to remove.
 *
 * Built on `formatToParts` rather than a locale that happens to emit ISO order,
 * so the output does not depend on the runtime's locale data.
 */
export function localDay(now: Date, timezone: string): string {
  if (!isValidTimeZone(timezone)) {
    throw new Error(`localDay: unknown IANA timezone ${timezone}`);
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  const year = get('year');
  const month = get('month');
  const day = get('day');
  if (!year || !month || !day) throw new Error(`localDay: could not format date for ${timezone}`);

  return `${year}-${month}-${day}`;
}

/** Falls back to UTC for a user who hasn't finished onboarding (T-014 leaves
 *  `timezone` null until then), so nothing crashes mid-signup. */
export function localDayFor(now: Date, timezone: string | null): string {
  return localDay(now, timezone ?? 'UTC');
}
