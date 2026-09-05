import { KNOWN_THRESHOLD } from './diagnostic.js';
import { fromDbCard, predictedRecall, type DbCard } from '../scheduler/index.js';
import type { ConceptState } from '../shared/index.js';

/** Below this, a taught concept is slipping and worth surfacing (T-017). */
export const AT_RISK_BELOW = 0.6;

export interface ConceptInput {
  id: string;
  order: number;
  heldOut: boolean;
  /** Null when the learner has no card for this concept yet. */
  card: (DbCard & { taughtAt: Date | null }) | null;
  /** The diagnostic's estimate, if the walk covered this concept. */
  diagnosticEstimate: number | undefined;
}

export interface ScoredConcept {
  conceptId: string;
  order: number;
  state: ConceptState;
  mastery: number;
  atRisk: boolean;
}

/**
 * Mastery is `predictedRecall(card, now)` and nothing else.
 *
 * There is deliberately no stored `mastery` column: T-015 seeds a known
 * concept's FSRS state so its predicted recall starts high, and T-040 reads the
 * same function. A stored copy would be a second definition that drifts from
 * the scheduler the moment either changes.
 */
export function scoreConcept(concept: ConceptInput, now: Date): ScoredConcept {
  const mastery = concept.card ? predictedRecall(fromDbCard(concept.card), now) : 0;

  // "known" means the diagnostic found they already had it, so the session
  // planner skipped teaching it. Distinguishing it from "taught" is why the
  // day-30 comparison can separate what we did from what they arrived with.
  const known = (concept.diagnosticEstimate ?? 0) >= KNOWN_THRESHOLD;

  let state: ConceptState;
  if (concept.heldOut) state = 'heldout';
  else if (!concept.card?.taughtAt) state = 'untaught';
  else if (known) state = 'known';
  else state = 'taught';

  return {
    conceptId: concept.id,
    order: concept.order,
    state,
    mastery,
    atRisk: state === 'taught' && mastery < AT_RISK_BELOW,
  };
}

/**
 * Mean mastery over taught and known concepts, 0–100.
 *
 * Untaught concepts are excluded rather than counted as zero: including them
 * would peg the score near zero for most of the thirty days and barely move it,
 * when plan.md §4 wants a number that rises as recall improves. Held-out
 * concepts are excluded because the learner is never taught them at all.
 */
export function topicScore(concepts: ScoredConcept[]): number {
  const counted = concepts.filter((c) => c.state === 'taught' || c.state === 'known');
  if (counted.length === 0) return 0;
  const mean = counted.reduce((sum, c) => sum + c.mastery, 0) / counted.length;
  return Math.round(mean * 100);
}
