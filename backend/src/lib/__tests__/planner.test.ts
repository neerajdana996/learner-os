import { describe, expect, it } from 'vitest';
import { MAX_NEW_CONCEPTS, planSession, remainingDays } from '../planner.js';

const plan = (over: Partial<Parameters<typeof planSession>[0]> = {}) =>
  planSession({ readyCount: 20, dueCount: 10, remainingDays: 10, budgetMin: 15, ...over });

describe('planSession', () => {
  it('paces the map to finish by the end date', () => {
    // 20 concepts over 10 days is two a day.
    expect(plan({ readyCount: 20, remainingDays: 10 }).newConceptCount).toBe(2);
  });

  it('caps at three however far behind the schedule is', () => {
    expect(plan({ readyCount: 20, remainingDays: 2 }).newConceptCount).toBe(MAX_NEW_CONCEPTS);
    expect(plan({ readyCount: 200, remainingDays: 1 }).newConceptCount).toBe(MAX_NEW_CONCEPTS);
  });

  it('never offers more new concepts than are actually ready', () => {
    expect(plan({ readyCount: 1, remainingDays: 1 }).newConceptCount).toBe(1);
    expect(plan({ readyCount: 0, dueCount: 0 }).newConceptCount).toBe(0);
  });

  it('fits a five-minute budget by trimming new concepts first', () => {
    const result = plan({ budgetMin: 5, readyCount: 20, remainingDays: 2, dueCount: 10 });
    // 5 min = 300s. One new concept costs 180s, leaving 120s for two reviews.
    expect(result.newConceptCount).toBe(1);
    expect(result.reviewCount).toBe(2);
  });

  it('spends the remaining budget on reviews', () => {
    const result = plan({ budgetMin: 15, readyCount: 20, remainingDays: 10, dueCount: 50 });
    // 900s − 2×180s = 540s, which is twelve 45s reviews.
    expect(result.newConceptCount).toBe(2);
    expect(result.reviewCount).toBe(12);
  });

  it('never offers more reviews than are due', () => {
    expect(plan({ dueCount: 3, budgetMin: 60 }).reviewCount).toBe(3);
  });

  it('offers one item rather than an empty session when the budget is tiny', () => {
    // An empty plan reads as "you're done for today" and stalls the course.
    expect(plan({ budgetMin: 0, dueCount: 5 })).toEqual({ newConceptCount: 0, reviewCount: 1 });
    expect(plan({ budgetMin: 0, dueCount: 0, readyCount: 4 })).toEqual({
      newConceptCount: 1,
      reviewCount: 0,
    });
  });

  it('returns an empty plan only when there is genuinely nothing to do', () => {
    expect(plan({ readyCount: 0, dueCount: 0 })).toEqual({ newConceptCount: 0, reviewCount: 0 });
  });

  it('does not divide by zero on or past the end date', () => {
    for (const days of [0, -1, -30]) {
      const result = plan({ remainingDays: days, readyCount: 20 });
      expect(Number.isFinite(result.newConceptCount)).toBe(true);
      expect(result.newConceptCount).toBe(MAX_NEW_CONCEPTS);
    }
  });
});

describe('remainingDays', () => {
  const now = new Date('2026-09-05T10:00:00Z');

  it('counts whole days until the end date', () => {
    expect(remainingDays(new Date('2026-09-15T10:00:00Z'), now)).toBe(10);
  });

  it('floors at zero once the end date has passed', () => {
    expect(remainingDays(new Date('2026-09-01T10:00:00Z'), now)).toBe(0);
  });

  it('treats a topic with no end date as unpaced', () => {
    expect(remainingDays(null, now)).toBe(0);
  });
});
