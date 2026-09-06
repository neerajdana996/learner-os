import { localDayFor } from './today.js';

const DAY = 86_400_000;
export interface LifecycleTopic { startsAt: Date | null; endsAt: Date | null; status: string }
/** startsAt anchors the Day-0 baseline. Calendar arithmetic avoids a DST day shifting the test. */
export function coldTestDay(startsAt: Date, timezone: string | null): string {
  const firstDay = localDayFor(startsAt, timezone);
  return new Date(Date.parse(`${firstDay}T00:00:00Z`) + 30 * DAY).toISOString().slice(0, 10);
}
export function localHour(now: Date, timezone: string | null): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: timezone ?? 'UTC', hour: '2-digit', hourCycle: 'h23' }).format(now));
}
export function testIsDue(topic: LifecycleTopic, timezone: string | null, now: Date): boolean {
  if (!topic.startsAt || !topic.endsAt || topic.endsAt > now || !['active', 'holdout', 'testing'].includes(topic.status)) return false;
  const today = localDayFor(now, timezone);
  const dueDay = coldTestDay(topic.startsAt, timezone);
  // Catch up after downtime, even before 06:00 on a later day.
  return today > dueDay || (today === dueDay && localHour(now, timezone) >= 6);
}
