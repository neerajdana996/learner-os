import { describe, expect, it } from 'vitest';
import {
  HELD_OUT_MAX_SHARE,
  HELD_OUT_MIN,
  HELD_OUT_MIN_ORDER,
  pickHeldOut,
  seededRng,
} from '../heldOut.js';

const topic = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ slug: `c${i + 1}`, order: i + 1 }));

describe('pickHeldOut', () => {
  it('gives a seven-day topic a control arm worth measuring', () => {
    // The reason this changed (T-123): `max(1, floor(15 * 0.1))` was **one**
    // concept, and the cold test asks one question per held-out concept — a
    // single question scored 0 or 1, standing in for half the pilot's headline
    // comparison.
    expect(pickHeldOut(topic(15), 0.1, HELD_OUT_MIN_ORDER, seededRng(1)).size).toBe(3);
  });

  it('still scales up on a large topic', () => {
    expect(pickHeldOut(topic(40), 0.1, HELD_OUT_MIN_ORDER, seededRng(1)).size).toBe(4);
  });

  it('never holds out more than a quarter of the course', () => {
    // The floor alone would take three of eight. Every held-out concept is one
    // the learner paid for and never receives.
    const held = pickHeldOut(topic(8), 0.1, HELD_OUT_MIN_ORDER, seededRng(1));

    expect(held.size).toBe(Math.floor(8 * HELD_OUT_MAX_SHARE));
    expect(held.size).toBeLessThan(HELD_OUT_MIN);
  });

  it('never holds out a foundation concept', () => {
    // Holding out something the rest depends on breaks every concept after it.
    const held = pickHeldOut(topic(20), 0.1, HELD_OUT_MIN_ORDER, seededRng(9));

    for (const slug of held) {
      expect(Number(slug.slice(1))).toBeGreaterThan(HELD_OUT_MIN_ORDER);
    }
  });

  it('cannot ask for more than there are eligible concepts', () => {
    // Only c4 clears the minimum order in a four-concept topic.
    expect(pickHeldOut(topic(4), 0.1, HELD_OUT_MIN_ORDER, seededRng(1)).size).toBeLessThanOrEqual(1);
  });

  it('is reproducible for a given seed', () => {
    expect([...pickHeldOut(topic(20), 0.1, HELD_OUT_MIN_ORDER, seededRng(42))]).toEqual(
      [...pickHeldOut(topic(20), 0.1, HELD_OUT_MIN_ORDER, seededRng(42))],
    );
  });
});
