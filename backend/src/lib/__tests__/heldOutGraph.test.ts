import { describe, expect, it } from 'vitest';
import { pickHeldOut, seededRng, HELD_OUT_MIN_ORDER, type OrderedConcept } from '../heldOut.js';

/**
 * T-165 — a held-out concept may not have a taught concept standing on it.
 *
 * The control arm is half of the pilot's headline comparison, and the way it
 * fails is silent: the learner is taught the control concept anyway, by the
 * lessons that have to reach for it, and the day-30 gap reads as no effect.
 */

/** The real map from the first successful free-text generation (topic
 *  `8454d6a6`, *HashMap + prefix sums*, 2026-09-12), slugs and edges exactly as
 *  the generator wrote them. `prefix-complement` is the concept that was held
 *  out while three taught concepts stood on it. */
const HASHMAP_PREFIX_SUMS: OrderedConcept[] = [
  { slug: 'prefix-sum-at-each-index', order: 1, prereqs: [] },
  { slug: 'negative-values-break-window-logic', order: 2, prereqs: [] },
  { slug: 'question-decides-map-storage', order: 3, prereqs: [] },
  { slug: 'prefix-before-the-array', order: 4, prereqs: ['prefix-sum-at-each-index'] },
  { slug: 'subarray-as-prefix-difference', order: 5, prereqs: ['prefix-sum-at-each-index'] },
  { slug: 'prefix-complement', order: 6, prereqs: ['subarray-as-prefix-difference'] },
  { slug: 'when-prefix-hashmap-fits', order: 7, prereqs: ['negative-values-break-window-logic', 'prefix-complement'] },
  { slug: 'repeated-prefix-sums', order: 8, prereqs: ['prefix-sum-at-each-index'] },
  { slug: 'seen-prefixes-for-existence', order: 9, prereqs: ['question-decides-map-storage', 'prefix-complement'] },
  { slug: 'frequencies-for-counting', order: 10, prereqs: ['question-decides-map-storage', 'repeated-prefix-sums'] },
  { slug: 'earliest-index-for-longest', order: 11, prereqs: ['question-decides-map-storage', 'prefix-complement', 'repeated-prefix-sums'] },
  { slug: 'counting-seed', order: 12, prereqs: ['prefix-before-the-array', 'frequencies-for-counting'] },
  { slug: 'longest-seed', order: 13, prereqs: ['prefix-before-the-array', 'earliest-index-for-longest'] },
  { slug: 'look-up-before-inserting', order: 14, prereqs: ['prefix-complement'] },
  { slug: 'one-pass-counting-loop', order: 15, prereqs: ['counting-seed', 'look-up-before-inserting'] },
  { slug: 'time-and-space-cost', order: 16, prereqs: ['when-prefix-hashmap-fits'] },
];

const dependantsOf = (concepts: OrderedConcept[], slug: string) =>
  concepts.filter((c) => (c.prereqs ?? []).includes(slug)).map((c) => c.slug);

/** The invariant, asserted the same way everywhere: nothing taught may stand on
 *  something held out. */
function expectNoTaughtDependants(concepts: OrderedConcept[], heldOut: Set<string>) {
  for (const slug of heldOut) {
    for (const dependant of dependantsOf(concepts, slug)) {
      expect(heldOut.has(dependant)).toBe(true);
    }
  }
}

describe('pickHeldOut and the prerequisite graph', () => {
  it('never holds out a concept a taught concept is built on', () => {
    // Sweep seeds so this cannot pass on one lucky draw, the way the existing
    // minOrder test does.
    for (let seed = 0; seed < 60; seed++) {
      const heldOut = pickHeldOut(HASHMAP_PREFIX_SUMS, 0.1, HELD_OUT_MIN_ORDER, seededRng(seed));
      expectNoTaughtDependants(HASHMAP_PREFIX_SUMS, heldOut);
    }
  });

  it('does not hold out `prefix-complement`, the concept three taught concepts stood on', () => {
    for (let seed = 0; seed < 60; seed++) {
      const heldOut = pickHeldOut(HASHMAP_PREFIX_SUMS, 0.1, HELD_OUT_MIN_ORDER, seededRng(seed));
      expect(heldOut.has('prefix-complement')).toBe(false);
    }
  });

  it('holds out a middle concept when everything standing on it is held out too', () => {
    // b is only ever depended on by c. Holding out both is legitimate: the
    // exclusion is about *taught* dependants, not about having dependants.
    const chain: OrderedConcept[] = [
      { slug: 'a1', order: 1, prereqs: [] },
      { slug: 'a2', order: 2, prereqs: [] },
      { slug: 'a3', order: 3, prereqs: [] },
      { slug: 'b', order: 4, prereqs: ['a1'] },
      { slug: 'c', order: 5, prereqs: ['b'] },
      { slug: 'd', order: 6, prereqs: [] },
      { slug: 'e', order: 7, prereqs: [] },
      { slug: 'f', order: 8, prereqs: [] },
    ];

    // Over enough seeds the pair does come up, and whenever `b` is chosen `c`
    // is chosen with it.
    let sawB = false;
    for (let seed = 0; seed < 60; seed++) {
      const heldOut = pickHeldOut(chain, 0.4, HELD_OUT_MIN_ORDER, seededRng(seed));
      if (heldOut.has('b')) {
        sawB = true;
        expect(heldOut.has('c')).toBe(true);
      }
      expectNoTaughtDependants(chain, heldOut);
    }
    expect(sawB).toBe(true);
  });

  it('never holds out a prereq whose dependant is ineligible by order', () => {
    // `early` is taught because order <= minOrder, so `late` can never be held
    // out however the draw falls — its dependant cannot join it.
    const concepts: OrderedConcept[] = [
      { slug: 'late', order: 4, prereqs: [] },
      { slug: 'early', order: 2, prereqs: ['late'] },
      { slug: 'x', order: 5, prereqs: [] },
      { slug: 'y', order: 6, prereqs: [] },
      { slug: 'z', order: 7, prereqs: [] },
    ];

    for (let seed = 0; seed < 40; seed++) {
      const heldOut = pickHeldOut(concepts, 0.5, HELD_OUT_MIN_ORDER, seededRng(seed));
      expect(heldOut.has('late')).toBe(false);
    }
  });

  it('returns a thin arm rather than a contaminated one when the graph leaves too few', () => {
    // c1..c3 are taught by order and each stands on one of the three eligible
    // concepts, so nothing at all can be held out. Returning an empty arm is the
    // honest answer; the worker turns it into a `thin_control_arm` warning.
    const concepts: OrderedConcept[] = [
      { slug: 'c1', order: 1, prereqs: ['c4'] },
      { slug: 'c2', order: 2, prereqs: ['c5'] },
      { slug: 'c3', order: 3, prereqs: ['c6'] },
      { slug: 'c4', order: 4, prereqs: [] },
      { slug: 'c5', order: 5, prereqs: [] },
      { slug: 'c6', order: 6, prereqs: [] },
    ];

    const heldOut = pickHeldOut(concepts, 0.5, HELD_OUT_MIN_ORDER, seededRng(3));

    expect(heldOut.size).toBe(0);
    expectNoTaughtDependants(concepts, heldOut);
  });

  it('still works for a caller with no graph at all', () => {
    // `seed.ts` and the older tests pass bare {slug, order} pairs; absent
    // prereqs read as none rather than throwing.
    const bare = Array.from({ length: 20 }, (_, i) => ({ slug: `c${i + 1}`, order: i + 1 }));
    expect(pickHeldOut(bare, 0.1, HELD_OUT_MIN_ORDER, seededRng(42)).size).toBe(3);
  });

  it('is still deterministic for a given seed', () => {
    const a = [...pickHeldOut(HASHMAP_PREFIX_SUMS, 0.1, HELD_OUT_MIN_ORDER, seededRng(7))].sort();
    const b = [...pickHeldOut(HASHMAP_PREFIX_SUMS, 0.1, HELD_OUT_MIN_ORDER, seededRng(7))].sort();
    expect(a).toEqual(b);
  });
});
