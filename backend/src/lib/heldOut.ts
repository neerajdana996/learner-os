// Held-out concept selection (plan.md §6): ~10% of concepts are never taught
// and never reviewed — they only ever appear in the Day-0/30/45 tests, as the
// control group that tells us whether teaching actually caused the retention
// gain. Pure and seedable so the choice is reproducible in tests.

export const HELD_OUT_RATIO = 0.1;
/** The first 3 concepts by order are always taught — holding out a foundation
 *  concept would break every concept that depends on it. */
export const HELD_OUT_MIN_ORDER = 3;

export interface OrderedConcept {
  slug: string;
  order: number;
}

/** Deterministic PRNG (mulberry32) so tests can pin the selection. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Picks the slugs to hold out: `max(1, floor(n * ratio))` of them, drawn only
 * from concepts with `order > minOrder`, capped at however many are eligible.
 */
export function pickHeldOut(
  concepts: readonly OrderedConcept[],
  ratio: number = HELD_OUT_RATIO,
  minOrder: number = HELD_OUT_MIN_ORDER,
  rng: () => number = Math.random,
): Set<string> {
  const eligible = concepts.filter((concept) => concept.order > minOrder);
  const target = Math.min(Math.max(1, Math.floor(concepts.length * ratio)), eligible.length);

  // Sort by a random key rather than index-swapping: same uniform result, no
  // array indexing to type-guard.
  const shuffled = eligible
    .map((concept) => ({ slug: concept.slug, key: rng() }))
    .sort((a, b) => a.key - b.key)
    .slice(0, target)
    .map((concept) => concept.slug);

  return new Set(shuffled);
}
