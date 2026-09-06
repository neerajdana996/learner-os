import { describe, expect, it } from 'vitest';
import { AT_RISK_BELOW, scoreConcept, topicScore, type ScoredConcept } from '../score.js';

const scored = (over: Partial<ScoredConcept>): ScoredConcept => ({
  conceptId: 'c',
  order: 1,
  state: 'taught',
  mastery: 1,
  atRisk: false,
  ...over,
});

const now = new Date('2026-09-05T12:00:00Z');

/** A card whose predicted recall is ~1: reviewed just now with real stability. */
const freshCard = (taughtAt: Date | null) => ({
  due: new Date(now.getTime() + 86_400_000),
  stability: 10,
  difficulty: 5,
  elapsedDays: 0,
  scheduledDays: 1,
  reps: 1,
  lapses: 0,
  state: 2,
  lastReview: now,
  taughtAt,
});

describe('scoreConcept', () => {
  it('reports untaught with zero mastery when there is no card', () => {
    const result = scoreConcept(
      { id: 'c', order: 1, heldOut: false, card: null, diagnosticEstimate: undefined },
      now,
    );
    expect(result.state).toBe('untaught');
    expect(result.mastery).toBe(0);
    expect(result.atRisk).toBe(false);
  });

  it('reports held-out regardless of any card state', () => {
    const result = scoreConcept(
      { id: 'c', order: 1, heldOut: true, card: freshCard(now), diagnosticEstimate: 0.9 },
      now,
    );
    expect(result.state).toBe('heldout');
  });

  it('separates a concept the learner already knew from one we taught', () => {
    const base = { id: 'c', order: 1, heldOut: false, card: freshCard(now) };
    // The diagnostic estimate is what says "they arrived with this" — the day-30
    // comparison depends on telling the two apart.
    expect(scoreConcept({ ...base, diagnosticEstimate: 0.9 }, now).state).toBe('known');
    expect(scoreConcept({ ...base, diagnosticEstimate: 0.4 }, now).state).toBe('taught');
    expect(scoreConcept({ ...base, diagnosticEstimate: undefined }, now).state).toBe('taught');
  });

  it('flags a taught concept as at risk only once mastery slips', () => {
    // A card last reviewed long ago has decayed well below the threshold.
    const stale = { ...freshCard(now), lastReview: new Date('2026-01-01T00:00:00Z'), stability: 1 };
    const result = scoreConcept(
      { id: 'c', order: 1, heldOut: false, card: stale, diagnosticEstimate: 0.2 },
      now,
    );
    expect(result.mastery).toBeLessThan(AT_RISK_BELOW);
    expect(result.atRisk).toBe(true);
  });

  it('never flags untaught or held-out concepts as at risk', () => {
    for (const heldOut of [true, false]) {
      const result = scoreConcept(
        { id: 'c', order: 1, heldOut, card: null, diagnosticEstimate: undefined },
        now,
      );
      expect(result.atRisk).toBe(false);
    }
  });
});

describe('topicScore', () => {
  it('is zero when nothing has been taught', () => {
    expect(topicScore([scored({ state: 'untaught', mastery: 0 })])).toBe(0);
    // Not NaN — an empty mean would render as "NaN" in the header badge.
    expect(topicScore([])).toBe(0);
  });

  it('averages taught mastery and scales to 100', () => {
    expect(
      topicScore([scored({ mastery: 1 }), scored({ conceptId: 'd', mastery: 0.5 })]),
    ).toBe(75);
  });

  it('excludes untaught concepts rather than counting them as zero', () => {
    const concepts = [
      scored({ mastery: 1 }),
      ...Array.from({ length: 10 }, (_, i) => scored({ conceptId: `u${i}`, state: 'untaught', mastery: 0 })),
    ];
    // Counting them would peg the score near zero for most of the thirty days.
    expect(topicScore(concepts)).toBe(100);
  });

  it('excludes held-out concepts, which are never taught at all', () => {
    expect(
      topicScore([scored({ mastery: 1 }), scored({ conceptId: 'h', state: 'heldout', mastery: 0 })]),
    ).toBe(100);
  });

  it('counts known concepts toward the score', () => {
    expect(
      topicScore([scored({ state: 'known', mastery: 0.8 }), scored({ conceptId: 'd', mastery: 0.6 })]),
    ).toBe(70);
  });
});
