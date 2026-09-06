import { describe, expect, it } from 'vitest';
import { coldTestDay, testIsDue } from '../testLifecycle.js';

const topic = { status: 'holdout', startsAt: new Date('2026-09-01T00:00:00Z'), endsAt: new Date('2026-09-08T00:00:00Z') };
describe('Day-30 user-local lifecycle', () => {
  it('leaves 23 calendar days after a seven-day course', () => {
    expect((Date.parse(coldTestDay(topic.startsAt, 'UTC')) - topic.endsAt.getTime()) / 86_400_000).toBe(23);
  });
  it('waits until 06:00 on Day 30 in a half-hour timezone', () => {
    expect(testIsDue(topic, 'Asia/Kolkata', new Date('2026-10-01T00:29:59Z'))).toBe(false);
    expect(testIsDue(topic, 'Asia/Kolkata', new Date('2026-10-01T00:30:00Z'))).toBe(true);
    expect(testIsDue(topic, 'Asia/Kolkata', new Date('2026-09-08T07:00:00Z'))).toBe(false);
  });
  it('honours a quarter-hour timezone and DST calendar dates', () => {
    expect(testIsDue(topic, 'Asia/Kathmandu', new Date('2026-10-01T00:14:59Z'))).toBe(false);
    expect(testIsDue(topic, 'Asia/Kathmandu', new Date('2026-10-01T00:15:00Z'))).toBe(true);
    const dst = { ...topic, startsAt: new Date('2026-10-15T04:00:00Z'), endsAt: new Date('2026-10-22T04:00:00Z') };
    expect(coldTestDay(dst.startsAt, 'America/New_York')).toBe('2026-11-14');
    expect(testIsDue(dst, 'America/New_York', new Date('2026-11-14T10:59:59Z'))).toBe(false);
    expect(testIsDue(dst, 'America/New_York', new Date('2026-11-14T11:00:00Z'))).toBe(true);
  });
  it('catches up after downtime, but never schedules finished topics or before teaching ends', () => {
    expect(testIsDue(topic, 'UTC', new Date('2026-10-02T01:00:00Z'))).toBe(true);
    expect(testIsDue({ ...topic, status: 'done' }, 'UTC', new Date('2026-10-15T07:00:00Z'))).toBe(false);
    expect(testIsDue({ ...topic, startsAt: null }, 'UTC', new Date('2026-10-15T07:00:00Z'))).toBe(false);
    expect(testIsDue({ ...topic, endsAt: new Date('2026-11-01') }, 'UTC', new Date('2026-10-01T07:00:00Z'))).toBe(false);
  });
});
