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
  /**
   * The slugs this concept is built on. Absent is read as "none" so the seed
   * and the older unit tests can keep passing bare `{slug, order}` pairs — but
   * a caller that *has* the graph must pass it, or the control arm can end up
   * holding a concept the course goes on to teach around (T-165).
   */
  prereqs?: readonly string[];
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
 *
 * **A held-out concept may not have a taught concept standing on it** (T-165).
 *
 * Found in the first real free-text generation: `prefix-complement` — the whole
 * mechanism of *HashMap + prefix sums* — was held out while three taught
 * concepts listed it as a prerequisite. The lessons for those three then had to
 * reach for it, and two stated it outright, one of them as
 * `freq.get(prefix - k, 0)`. The learner read "the prefix complement you
 * already know" about something they were never taught, and the control arm was
 * taught anyway — which makes the day-30 taught-versus-held-out gap, the one
 * number the pilot exists to produce, read as no effect for a reason nothing
 * anywhere would have reported.
 *
 * The `exclude` set above was aimed at this same risk and misses it, because
 * crux is the model's judgement about which ideas are thresholds while this is
 * a question the prerequisite graph answers outright. Both are kept: they catch
 * different things.
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

  /** Who stands on whom: prereq slug → the concepts that list it. */
  const dependants = new Map<string, string[]>();
  for (const concept of concepts) {
    for (const prereq of concept.prereqs ?? []) {
      const list = dependants.get(prereq);
      if (list) list.push(concept.slug);
      else dependants.set(prereq, [concept.slug]);
    }
  }

  // Sort by a random key rather than index-swapping: same uniform result, no
  // array indexing to type-guard.
  const shuffled = eligible
    .map((concept) => ({ slug: concept.slug, key: rng() }))
    .sort((a, b) => a.key - b.key)
    .map((concept) => concept.slug);

  /**
   * Repeated passes rather than one, because eligibility depends on what has
   * already been chosen: a concept can be held out once every concept standing
   * on it is held out too, so a prereq only becomes available after its
   * dependants have been taken. One pass in a random order would miss those
   * and under-fill the arm for no reason.
   *
   * Adding to the set can never invalidate an earlier choice — the condition is
   * "all my dependants are in the set" and the set only grows — so the loop is
   * safe to run to a fixpoint, and the rng having already fixed the order keeps
   * it deterministic.
   */
  const selected = new Set<string>();
  for (let changed = true; changed && selected.size < target; ) {
    changed = false;
    for (const slug of shuffled) {
      if (selected.size >= target) break;
      if (selected.has(slug)) continue;
      // No dependants at all is the common case and the safest control: a leaf
      // concept is one nothing else in the course is built on.
      if (!(dependants.get(slug) ?? []).every((d) => selected.has(d))) continue;
      selected.add(slug);
      changed = true;
    }
  }

  return selected;
}
