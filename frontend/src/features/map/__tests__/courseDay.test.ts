import { describe, expect, it } from 'vitest';
import { courseDay } from '../pages/MapPage';

const start = Date.parse('2026-09-01T00:00:00Z');
const end = Date.parse('2026-10-01T00:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const DAY = 86_400_000;

describe('courseDay', () => {
  it('counts the first day as day 1, not day 0', () => {
    // "Day 0 of 30" reads as though nothing has begun.
    expect(courseDay(iso(start), iso(end), start)).toEqual({ day: 1, total: 30 });
    expect(courseDay(iso(start), iso(end), start + DAY * 11)).toEqual({ day: 12, total: 30 });
  });

  it('never runs past the last day', () => {
    expect(courseDay(iso(start), iso(end), start + DAY * 60)).toEqual({ day: 30, total: 30 });
  });

  it('never goes below day 1, even before the start date', () => {
    expect(courseDay(iso(start), iso(end), start - DAY * 3)).toEqual({ day: 1, total: 30 });
  });

  it('shows nothing rather than a wrong number when dates are missing', () => {
    // The Sprint 1 demo topic has no dates at all; "day NaN of NaN" is worse
    // than no counter.
    expect(courseDay(null, iso(end))).toBeNull();
    expect(courseDay(iso(start), null)).toBeNull();
    expect(courseDay(undefined, undefined)).toBeNull();
    expect(courseDay(iso(end), iso(start))).toBeNull();
  });
});
