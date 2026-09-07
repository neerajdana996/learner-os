import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/client.js';
import { clientEvents, concepts, reviewEvents, tests, topics } from '../../db/schema.js';
import { seedUser, truncateAll } from '../../test/db.js';
import {
  calibrationGapDelta,
  extensionStats,
  retentionGain,
  schedulerCalibration,
  teachModeComparison,
  transfer,
} from '../metrics.js';

const scores = (over: Partial<Record<string, unknown>> = {}) => ({
  overall: 0.5,
  taught: 0.5,
  heldOut: 0.5,
  transfer: 0.5,
  calibrationGap: 0.2,
  perConcept: {},
  ...over,
});

let user: Awaited<ReturnType<typeof seedUser>>;
let topicId: string;

beforeEach(async () => {
  await truncateAll();
  user = await seedUser();
  const [topic] = await db
    .insert(topics)
    .values({ userId: user.id, title: 'Distributed systems', status: 'active' })
    .returning({ id: topics.id });
  topicId = topic!.id;
});

async function seedTest(kind: 'day0' | 'day30' | 'day45', s: Record<string, unknown>) {
  await db.insert(tests).values({ userId: user.id, topicId, kind, itemIds: [], scores: s });
}

async function seedConcept(slug: string, teachMode: 'try_first' | 'example_first' | null) {
  const [c] = await db
    .insert(concepts)
    .values({ topicId, slug, title: slug, order: 1, teachMode })
    .returning({ id: concepts.id });
  return c!.id;
}

async function seedReview(over: {
  conceptId: string;
  correct: boolean | null;
  predictedRecall: number;
  gap: number | null;
  surface?: 'web' | 'extension' | 'test' | 'diagnostic';
  latencyMs?: number | null;
  snoozed?: boolean;
  dismissed?: boolean;
}) {
  await db.insert(reviewEvents).values({
    userId: user.id,
    conceptId: over.conceptId,
    correct: over.correct,
    predictedRecall: over.predictedRecall,
    gapDaysSinceLast: over.gap,
    surface: over.surface ?? 'web',
    latencyMs: over.latencyMs ?? null,
    snoozed: over.snoozed ?? false,
    dismissed: over.dismissed ?? false,
  });
}

describe('retentionGain', () => {
  it('is the taught delta minus the held-out delta', async () => {
    // Taught 0.4 → 0.9 (+0.5); held out 0.4 → 0.5 (+0.1). People improve on
    // their own; the only defensible claim is the difference.
    await seedTest('day0', scores({ taught: 0.4, heldOut: 0.4 }));
    await seedTest('day30', scores({ taught: 0.9, heldOut: 0.5 }));

    const result = await retentionGain(user.id, topicId);

    expect(result.taught).toBe(0.5);
    expect(result.heldOut).toBe(0.1);
    expect(result.gain).toBe(0.4);
  });

  it('refuses to report a gain without the held-out arm', async () => {
    // A taught delta alone is the number a marketing page would quote, and it
    // is not evidence. Null, not the taught delta.
    await seedTest('day0', scores({ taught: 0.4, heldOut: null }));
    await seedTest('day30', scores({ taught: 0.9, heldOut: null }));

    const result = await retentionGain(user.id, topicId);

    expect(result.taught).toBe(0.5);
    expect(result.gain).toBeNull();
  });

  it('is null when the Day-30 test was never taken', async () => {
    await seedTest('day0', scores());
    expect((await retentionGain(user.id, topicId)).gain).toBeNull();
  });

  it('treats an unfinished test as no measurement, not as zero', async () => {
    // `scores` is `{}` until a test is graded. Averaging that in as 0 would
    // manufacture a decline nobody experienced.
    await seedTest('day0', scores());
    await seedTest('day30', {});

    expect((await retentionGain(user.id, topicId)).gain).toBeNull();
  });
});

describe('transfer and calibration', () => {
  it('reads transfer off the Day-30 test', async () => {
    await seedTest('day30', scores({ transfer: 0.7 }));
    expect(await transfer(user.id, topicId)).toBe(0.7);
  });

  it('reports a shrinking confidence gap as a negative delta', async () => {
    // Positive calibrationGap is overconfidence, so improvement is negative —
    // the one metric here whose sign reads backwards.
    await seedTest('day0', scores({ calibrationGap: 0.3 }));
    await seedTest('day30', scores({ calibrationGap: 0.1 }));

    expect(await calibrationGapDelta(user.id, topicId)).toBe(-0.2);
  });
});

describe('schedulerCalibration', () => {
  it('bins predictions and reports what actually happened', async () => {
    const c = await seedConcept('a', 'try_first');
    // Four reviews in the 0.8 bin, three of them right → 0.75 actual.
    for (const correct of [true, true, true, false]) {
      await seedReview({ conceptId: c, correct, predictedRecall: 0.85, gap: 3 });
    }
    // Two in the 0.5 bin, one right → 0.5.
    for (const correct of [true, false]) {
      await seedReview({ conceptId: c, correct, predictedRecall: 0.55, gap: 3 });
    }

    const bins = await schedulerCalibration(user.id);

    expect(bins).toEqual([
      { bin: 0.5, predicted: 0.55, actual: 0.5, n: 2 },
      { bin: 0.8, predicted: 0.85, actual: 0.75, n: 4 },
    ]);
  });

  it('excludes same-day answers, which measure echo rather than memory', async () => {
    const c = await seedConcept('a', 'try_first');
    await seedReview({ conceptId: c, correct: true, predictedRecall: 0.85, gap: 0 });
    await seedReview({ conceptId: c, correct: true, predictedRecall: 0.85, gap: null });

    expect(await schedulerCalibration(user.id)).toEqual([]);
  });

  it('excludes tests and the diagnostic, which the scheduler never chose', async () => {
    const c = await seedConcept('a', 'try_first');
    await seedReview({ conceptId: c, correct: true, predictedRecall: 0.85, gap: 3, surface: 'test' });
    await seedReview({ conceptId: c, correct: true, predictedRecall: 0.85, gap: 3, surface: 'diagnostic' });

    expect(await schedulerCalibration(user.id)).toEqual([]);
  });

  it('excludes a snooze, which answered nothing', async () => {
    const c = await seedConcept('a', 'try_first');
    await seedReview({ conceptId: c, correct: null, predictedRecall: 0.85, gap: 3, snoozed: true });

    expect(await schedulerCalibration(user.id)).toEqual([]);
  });
});

describe('teachModeComparison', () => {
  it('groups scored reviews by how the concept was taught', async () => {
    const tryFirst = await seedConcept('try', 'try_first');
    const exampleFirst = await seedConcept('example', 'example_first');
    for (const correct of [true, true, false, true]) {
      await seedReview({ conceptId: tryFirst, correct, predictedRecall: 0.7, gap: 2 });
    }
    for (const correct of [true, false]) {
      await seedReview({ conceptId: exampleFirst, correct, predictedRecall: 0.7, gap: 2 });
    }

    // Ordered by the pgEnum's declaration order, not alphabetically — Postgres
    // sorts an enum by how it was defined, and `try_first` is declared first.
    expect(await teachModeComparison(user.id)).toEqual([
      { teachMode: 'try_first', meanCorrect: 0.75, n: 4 },
      { teachMode: 'example_first', meanCorrect: 0.5, n: 2 },
    ]);
  });
});

describe('extensionStats', () => {
  it('takes the denominator from what was shown, not from what was answered', async () => {
    // The whole reason T-035 exists: a card nobody opened leaves no review row,
    // so an answer rate built from review rows is answers over answers.
    const c = await seedConcept('a', 'try_first');
    const at = new Date();
    await db.insert(clientEvents).values([
      { userId: user.id, event: 'card_shown', at },
      { userId: user.id, event: 'card_shown', at },
      { userId: user.id, event: 'card_shown', at },
      { userId: user.id, event: 'card_shown', at },
      { userId: user.id, event: 'card_closed_no_action', at },
    ]);
    await seedReview({ conceptId: c, correct: true, predictedRecall: 0.7, gap: 2, surface: 'extension', latencyMs: 4000 });
    await seedReview({ conceptId: c, correct: false, predictedRecall: 0.7, gap: 2, surface: 'extension', latencyMs: 8000 });
    await seedReview({ conceptId: c, correct: null, predictedRecall: 0.7, gap: 2, surface: 'extension', snoozed: true });

    const stats = await extensionStats(user.id);

    expect(stats.shown).toBe(4);
    expect(stats.answered).toBe(2);
    expect(stats.snoozed).toBe(1);
    expect(stats.closedNoAction).toBe(1);
    expect(stats.answerRate).toBe(0.5);
    expect(stats.medianLatencyMs).toBe(6000);
  });

  it('reports no answer rate rather than a zero one when nothing was shown', async () => {
    // "We have not measured this yet" and "nobody answered anything" are
    // opposite findings and must never look the same.
    const stats = await extensionStats(user.id);

    expect(stats.shown).toBe(0);
    expect(stats.answerRate).toBeNull();
    expect(stats.medianLatencyMs).toBeNull();
  });

  it('ignores web reviews, which the extension did not show', async () => {
    const c = await seedConcept('a', 'try_first');
    await db.insert(clientEvents).values({ userId: user.id, event: 'card_shown', at: new Date() });
    await seedReview({ conceptId: c, correct: true, predictedRecall: 0.7, gap: 2, surface: 'web' });

    const stats = await extensionStats(user.id);

    expect(stats.shown).toBe(1);
    expect(stats.answered).toBe(0);
  });

  it('counts only this learner', async () => {
    const other = await seedUser();
    await db.insert(clientEvents).values({ userId: other.id, event: 'card_shown', at: new Date() });

    expect((await extensionStats(user.id)).shown).toBe(0);
  });
});
