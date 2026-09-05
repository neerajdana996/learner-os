/**
 * The adaptive diagnostic (T-015): a deterministic walk over the prereq DAG.
 *
 * Pure on purpose — no DB, no clock, no randomness. The graph behaviour is the
 * part most likely to be subtly wrong, and keeping it pure means every case
 * below is a unit test with no fixtures. The module layer owns persistence.
 *
 * No IRT library: this is 10 people, not a psychometrics product (plan.md §5).
 */

/** plan.md §4: "~15 items". A hard ceiling, not a target. */
export const MAX_QUESTIONS = 15;
export const START_ESTIMATE = 0.5;
/** Below this an estimate counts as resolved-low, above resolved-high. While an
 *  estimate sits between them we still don't know, so the walk continues. */
export const RESOLVED_LOW = 0.35;
export const RESOLVED_HIGH = 0.65;
export const CORRECT_ESTIMATE = 0.9;
export const WRONG_ESTIMATE = 0.1;
export const PROPAGATION = 0.15;
/**
 * Propagation halves with each hop away from the answered concept.
 *
 * Without decay the full ±0.15 reaches every transitive neighbour, and on a
 * long chain a single wrong answer drags all 38 downstream concepts to exactly
 * the resolved boundary at once — the walk then declares itself finished after
 * two questions. Confidence in an inference should fall with distance from the
 * evidence, so it does.
 */
export const PROPAGATION_DECAY = 0.5;
/** At or above this the learner already knows it, so teaching is skipped and
 *  T-016's planner never offers it (plan.md §3.3: teach only the gap). */
export const KNOWN_THRESHOLD = 0.8;
/** A prerequisite is "solid enough to build on" at this estimate. */
const READY_THRESHOLD = 0.7;

export interface DiagnosticState {
  estimates: Record<string, number>;
  asked: string[];
}

export interface DiagnosticConcept {
  id: string;
  order: number;
  heldOut: boolean;
}

export interface Graph {
  /** concept -> the concepts that must be understood first */
  prereqs: Map<string, string[]>;
  /** concept -> the concepts that build on it */
  dependents: Map<string, string[]>;
}

export function buildGraph(edges: { conceptId: string; prerequisiteConceptId: string }[]): Graph {
  const prereqs = new Map<string, string[]>();
  const dependents = new Map<string, string[]>();
  for (const { conceptId, prerequisiteConceptId } of edges) {
    prereqs.set(conceptId, [...(prereqs.get(conceptId) ?? []), prerequisiteConceptId]);
    dependents.set(prerequisiteConceptId, [...(dependents.get(prerequisiteConceptId) ?? []), conceptId]);
  }
  return { prereqs, dependents };
}

export function initialState(concepts: DiagnosticConcept[]): DiagnosticState {
  const estimates: Record<string, number> = {};
  for (const concept of concepts) estimates[concept.id] = START_ESTIMATE;
  return { estimates, asked: [] };
}

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/**
 * The next concept to ask about, or null when the walk is finished.
 *
 * Two rules, in order: ask about something the learner is *ready* for (all
 * prerequisites either already estimated as solid, or at least already asked),
 * then among those pick the one we know least about — the estimate nearest 0.5,
 * where a single answer moves the most information.
 *
 * Ties break on `concepts.order` so the same state always yields the same
 * question. Without that the walk would depend on Map iteration order and the
 * tests would flake.
 */
export function next(
  state: DiagnosticState,
  concepts: DiagnosticConcept[],
  graph: Graph,
): string | null {
  if (state.asked.length >= MAX_QUESTIONS) return null;

  const asked = new Set(state.asked);
  const candidates = concepts.filter((c) => !c.heldOut && !asked.has(c.id));
  if (candidates.length === 0) return null;

  const ready = candidates.filter((c) => {
    const required = graph.prereqs.get(c.id) ?? [];
    return required.every((p) => asked.has(p) || (state.estimates[p] ?? START_ESTIMATE) > READY_THRESHOLD);
  });

  const pool = ready.length > 0 ? ready : candidates;

  let best = pool[0];
  if (!best) return null;
  let bestDistance = Math.abs((state.estimates[best.id] ?? START_ESTIMATE) - 0.5);

  for (const concept of pool.slice(1)) {
    const distance = Math.abs((state.estimates[concept.id] ?? START_ESTIMATE) - 0.5);
    if (distance < bestDistance || (distance === bestDistance && concept.order < best.order)) {
      best = concept;
      bestDistance = distance;
    }
  }
  return best.id;
}

/**
 * Records one answer and propagates the implication through the graph.
 *
 * Getting a hard thing right implies its foundations are sound, so a correct
 * answer lifts prerequisites. Missing a foundation implies what builds on it is
 * shaky, so a wrong answer lowers dependents.
 *
 * The walk is breadth-first with a visited set. The graph is acyclic, but a
 * diamond (A→B, A→C, B→D, C→D) reaches D by two paths, and without the guard D
 * would take the adjustment twice for one answer.
 */
export function apply(
  state: DiagnosticState,
  conceptId: string,
  correct: boolean,
  graph: Graph,
): DiagnosticState {
  const estimates = { ...state.estimates };
  estimates[conceptId] = correct ? CORRECT_ESTIMATE : WRONG_ESTIMATE;

  const edges = correct ? graph.prereqs : graph.dependents;
  const direction = correct ? 1 : -1;

  const visited = new Set<string>([conceptId]);
  let frontier = [...(edges.get(conceptId) ?? [])];
  let magnitude = PROPAGATION;

  while (frontier.length > 0 && magnitude >= 0.01) {
    const nextFrontier: string[] = [];
    for (const id of frontier) {
      if (visited.has(id)) continue;
      visited.add(id);
      estimates[id] = clamp((estimates[id] ?? START_ESTIMATE) + direction * magnitude);
      nextFrontier.push(...(edges.get(id) ?? []));
    }
    frontier = nextFrontier;
    magnitude *= PROPAGATION_DECAY;
  }

  // Answering the same concept twice must not consume two of the 15 slots.
  const asked = state.asked.includes(conceptId) ? state.asked : [...state.asked, conceptId];
  return { estimates, asked };
}

/** Done at the cap, or once every askable concept has resolved away from 0.5. */
export function isDone(state: DiagnosticState, concepts: DiagnosticConcept[]): boolean {
  if (state.asked.length >= MAX_QUESTIONS) return true;
  return concepts
    .filter((c) => !c.heldOut)
    .every((c) => {
      const estimate = state.estimates[c.id] ?? START_ESTIMATE;
      return estimate <= RESOLVED_LOW || estimate >= RESOLVED_HIGH;
    });
}

/** Confidence taps are collected to measure calibration, never to trust
 *  (plan.md §3.6). guess/think/sure map onto the numbers T-038 also uses. */
const CONFIDENCE_VALUE = { guess: 0.33, think: 0.66, sure: 1.0 } as const;

export function calibrationGap(
  answers: { confidence: keyof typeof CONFIDENCE_VALUE | null; correct: boolean }[],
): number | null {
  const rated = answers.filter((a) => a.confidence !== null);
  if (rated.length === 0) return null;
  const meanConfidence =
    rated.reduce((sum, a) => sum + CONFIDENCE_VALUE[a.confidence as keyof typeof CONFIDENCE_VALUE], 0) /
    rated.length;
  const accuracy = rated.filter((a) => a.correct).length / rated.length;
  return meanConfidence - accuracy;
}
