// Held-out concept selection (plan.md §6): ~10% of concepts are never taught
// and never reviewed — they only ever appear in the Day-0/30/45 tests, as the
// control group that tells us whether teaching actually caused the retention
// gain. Pure and seedable so the choice is reproducible in tests.

export const HELD_OUT_RATIO = 0.1;

/**
 * Never fewer than this many, however small the topic (T-123).
 *
 * At the seven-day shape a topic is 14–16 concepts, where the old
 * `max(1, floor(n * 0.1))` produced exactly **one** held-out concept — and the
 * cold test asks one question per held-out concept, so the control arm was a
 * single question scored 0 or 1. That is a coin flip standing in for half of
 * the pilot's headline comparison.
 */
export const HELD_OUT_MIN = 3;

/**
 * ...and never more than this share of the topic.
 *
 * The floor above would otherwise hold out half of a six-concept topic. Every
 * held-out concept is one the learner paid for and never receives, so the
 * control arm has to stay a minority of the course.
 */
export const HELD_OUT_MAX_SHARE = 0.25;
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
 * Picks the slugs to hold out, drawn only from concepts with `order > minOrder`.
 *
 * The count is `ratio` of the topic, raised to `HELD_OUT_MIN` so a small topic
 * still has a measurable control arm, then capped at `HELD_OUT_MAX_SHARE` of
 * the topic and at however many concepts are eligible — in that order, so the
 * cap always wins over the floor and a six-concept topic cannot end up half
 * untaught.
 */
export function pickHeldOut(
  concepts: readonly OrderedConcept[],
  ratio: number = HELD_OUT_RATIO,
  minOrder: number = HELD_OUT_MIN_ORDER,
  rng: () => number = Math.random,
  /**
   * Slugs that must never be held out — the map's `crux` concepts (T-163).
   *
   * Selection is otherwise uniform over everything past `minOrder`, which meant
   * a threshold concept could be silently removed from a learner's course. Two
   * things go wrong when it is: the learner is never taught the idea the rest of
   * the topic hangs off, and the day-30 comparison spends one of its three
   * control questions on the concept most likely to show an effect.
   *
   * Excluded from the *eligible pool*, not from the count — the control arm
   * stays ~10% of the whole topic rather than shrinking because some concepts
   * are load-bearing.
   */
  exclude: ReadonlySet<string> = new Set(),
): Set<string> {
  const eligible = concepts.filter(
    (concept) => concept.order > minOrder && !exclude.has(concept.slug),
  );
  const wanted = Math.max(HELD_OUT_MIN, Math.round(concepts.length * ratio));
  const target = Math.min(
    wanted,
    Math.floor(concepts.length * HELD_OUT_MAX_SHARE),
    eligible.length,
  );

  // Sort by a random key rather than index-swapping: same uniform result, no
  // array indexing to type-guard.
  const shuffled = eligible
    .map((concept) => ({ slug: concept.slug, key: rng() }))
    .sort((a, b) => a.key - b.key)
    .slice(0, target)
    .map((concept) => concept.slug);

  return new Set(shuffled);
}
