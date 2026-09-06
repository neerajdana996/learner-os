import { describe, expect, it } from 'vitest';
import {
  apply,
  buildGraph,
  calibrationGap,
  initialState,
  isDone,
  next,
  KNOWN_THRESHOLD,
  MAX_QUESTIONS,
  RESOLVED_LOW,
  START_ESTIMATE,
  type DiagnosticConcept,
} from '../diagnostic.js';

/** `n` concepts in teaching order, each depending on the one before it. */
function chain(n: number, heldOutIds: string[] = []) {
  const concepts: DiagnosticConcept[] = Array.from({ length: n }, (_, i) => ({
    id: `c${i + 1}`,
    order: i + 1,
    heldOut: heldOutIds.includes(`c${i + 1}`),
  }));
  const edges = Array.from({ length: n - 1 }, (_, i) => ({
    conceptId: `c${i + 2}`,
    prerequisiteConceptId: `c${i + 1}`,
  }));
  return { concepts, graph: buildGraph(edges) };
}

/** Walks the whole diagnostic, answering with `answer(conceptId, index)`. */
function walk(
  concepts: DiagnosticConcept[],
  graph: ReturnType<typeof buildGraph>,
  answer: (conceptId: string, index: number) => boolean,
) {
  let state = initialState(concepts);
  let index = 0;
  while (!isDone(state, concepts)) {
    const id = next(state, concepts, graph);
    if (id === null) break;
    state = apply(state, id, answer(id, index), graph);
    index += 1;
  }
  return state;
}

describe('next()', () => {
  it('never returns a held-out concept', () => {
    const { concepts, graph } = chain(12, ['c5', 'c9']);
    const state = walk(concepts, graph, () => true);
    expect(state.asked).not.toContain('c5');
    expect(state.asked).not.toContain('c9');
  });

  it('is deterministic for the same state', () => {
    const { concepts, graph } = chain(12);
    const state = initialState(concepts);
    const picks = new Set(Array.from({ length: 50 }, () => next(state, concepts, graph)));
    expect(picks.size).toBe(1);
  });

  it('prefers a concept whose prerequisites are already resolved', () => {
    const { concepts, graph } = chain(4);
    // Nothing asked yet: only c1 has no prerequisites, so it is the only
    // "ready" candidate and must be chosen over the equally-uncertain rest.
    expect(next(initialState(concepts), concepts, graph)).toBe('c1');
  });

  it('picks the most uncertain concept among ready ones', () => {
    const concepts: DiagnosticConcept[] = [
      { id: 'a', order: 1, heldOut: false },
      { id: 'b', order: 2, heldOut: false },
      { id: 'c', order: 3, heldOut: false },
    ];
    const graph = buildGraph([]);
    const state = { estimates: { a: 0.9, b: 0.5, c: 0.2 }, asked: [] };
    expect(next(state, concepts, graph)).toBe('b');
  });

  it('returns null once every askable concept has been asked', () => {
    const { concepts, graph } = chain(3);
    let state = initialState(concepts);
    for (const id of ['c1', 'c2', 'c3']) state = apply(state, id, true, graph);
    expect(next(state, concepts, graph)).toBeNull();
  });
});

describe('apply()', () => {
  it('raises transitive prerequisites on a correct answer', () => {
    const { concepts, graph } = chain(4);
    const state = apply(initialState(concepts), 'c4', true, graph);

    expect(state.estimates.c4).toBe(0.9);
    // c3, c2, c1 are transitive prerequisites of c4, and the inference weakens
    // with distance: +0.15, +0.075, +0.0375.
    expect(state.estimates.c3).toBeCloseTo(0.65);
    expect(state.estimates.c2).toBeCloseTo(0.575);
    expect(state.estimates.c1).toBeCloseTo(0.5375);
  });

  it('weakens the adjustment with each hop from the evidence', () => {
    const { concepts, graph } = chain(4);
    const state = apply(initialState(concepts), 'c4', true, graph);

    // Undecayed propagation would drag every concept in a long chain past the
    // resolved boundary at once and end the diagnostic after two questions.
    const lift = (id: string) => (state.estimates[id] ?? 0) - START_ESTIMATE;
    expect(lift('c3')).toBeGreaterThan(lift('c2'));
    expect(lift('c2')).toBeGreaterThan(lift('c1'));
  });

  it('lowers transitive dependents on a wrong answer', () => {
    const { concepts, graph } = chain(4);
    const state = apply(initialState(concepts), 'c1', false, graph);

    expect(state.estimates.c1).toBe(0.1);
    expect(state.estimates.c2).toBeCloseTo(0.35);
    expect(state.estimates.c3).toBeCloseTo(0.425);
    expect(state.estimates.c4).toBeCloseTo(0.4625);
  });

  it('applies the adjustment once per concept in a diamond', () => {
    // a -> b, a -> c, b -> d, c -> d: d is reachable from a by two paths.
    const concepts: DiagnosticConcept[] = ['a', 'b', 'c', 'd'].map((id, i) => ({
      id,
      order: i + 1,
      heldOut: false,
    }));
    const graph = buildGraph([
      { conceptId: 'b', prerequisiteConceptId: 'a' },
      { conceptId: 'c', prerequisiteConceptId: 'a' },
      { conceptId: 'd', prerequisiteConceptId: 'b' },
      { conceptId: 'd', prerequisiteConceptId: 'c' },
    ]);

    const state = apply(initialState(concepts), 'a', false, graph);

    expect(state.estimates.b).toBeCloseTo(0.35);
    expect(state.estimates.c).toBeCloseTo(0.35);
    // d is two hops away, reached via both b and c. One answer means one
    // adjustment at the two-hop weight: 0.5 - 0.075. Without the visited guard
    // it would be hit twice and land at 0.425 - 0.075 = 0.35.
    expect(state.estimates.d).toBeCloseTo(0.425);
  });

  it('clamps estimates into [0, 1]', () => {
    const { concepts, graph } = chain(3);
    let state = initialState(concepts);
    for (let i = 0; i < 10; i += 1) state = apply(state, 'c3', true, graph);
    expect(state.estimates.c1).toBeLessThanOrEqual(1);
    expect(state.estimates.c1).toBeGreaterThanOrEqual(0);
  });

  it('does not count the same concept twice toward the cap', () => {
    const { concepts, graph } = chain(3);
    let state = apply(initialState(concepts), 'c1', true, graph);
    state = apply(state, 'c1', false, graph);
    expect(state.asked).toEqual(['c1']);
  });
});

describe('the walk as a whole', () => {
  it('stops early and marks everything known when all answers are correct', () => {
    const { concepts, graph } = chain(12);
    const state = walk(concepts, graph, () => true);

    expect(state.asked.length).toBeLessThan(MAX_QUESTIONS);
    for (const concept of concepts) {
      expect(state.estimates[concept.id]).toBeGreaterThanOrEqual(KNOWN_THRESHOLD);
    }
  });

  it('leaves every estimate resolved-low when all answers are wrong', () => {
    const { concepts, graph } = chain(12);
    const state = walk(concepts, graph, () => false);

    for (const concept of concepts) {
      const estimate = state.estimates[concept.id] ?? 1;
      // Resolved low, not necessarily 0.1: concepts the walk inferred about
      // rather than asked sit wherever propagation left them. What matters is
      // that nothing is mistaken for known, so T-016 teaches all of it.
      expect(estimate).toBeLessThanOrEqual(RESOLVED_LOW);
      expect(estimate).toBeLessThan(KNOWN_THRESHOLD);
    }
    // Every concept the learner actually answered is pinned to the floor.
    for (const id of state.asked) expect(state.estimates[id]).toBe(0.1);
  });

  it('caps at exactly 15 questions on a 40-concept map with alternating answers', () => {
    const { concepts, graph } = chain(40);
    const state = walk(concepts, graph, (_id, index) => index % 2 === 0);
    expect(state.asked).toHaveLength(MAX_QUESTIONS);
  });

  it('starts every concept at 0.5', () => {
    const { concepts } = chain(5);
    const state = initialState(concepts);
    expect(Object.values(state.estimates)).toEqual(Array(5).fill(START_ESTIMATE));
  });

  it('is done once every estimate has resolved away from the middle', () => {
    const { concepts } = chain(2);
    expect(isDone({ estimates: { c1: 0.9, c2: 0.1 }, asked: ['c1', 'c2'] }, concepts)).toBe(true);
    expect(isDone({ estimates: { c1: 0.9, c2: 0.5 }, asked: ['c1'] }, concepts)).toBe(false);
  });

  it('ignores held-out concepts when deciding it is done', () => {
    const { concepts } = chain(3, ['c3']);
    // c3 is still at 0.5 but is never asked, so it must not keep the walk alive.
    expect(isDone({ estimates: { c1: 0.9, c2: 0.9, c3: 0.5 }, asked: ['c1', 'c2'] }, concepts)).toBe(true);
  });
});

describe('calibrationGap', () => {
  it('is confidence minus accuracy', () => {
    // Four "sure" answers (1.0 each), half correct.
    const gap = calibrationGap([
      { confidence: 'sure', correct: true },
      { confidence: 'sure', correct: true },
      { confidence: 'sure', correct: false },
      { confidence: 'sure', correct: false },
    ]);
    expect(gap).toBeCloseTo(0.5);
  });

  it('is negative for an under-confident learner', () => {
    const gap = calibrationGap([
      { confidence: 'guess', correct: true },
      { confidence: 'guess', correct: true },
    ]);
    expect(gap).toBeCloseTo(0.33 - 1);
  });

  it('ignores unrated answers and returns null when nothing was rated', () => {
    expect(calibrationGap([{ confidence: null, correct: true }])).toBeNull();
    expect(calibrationGap([])).toBeNull();
  });
});
