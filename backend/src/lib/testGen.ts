import type { Confidence, ItemType, TestScores } from '@learnos/shared';
import { isPopupEligible } from './popupEligible.js';

export const TEST_SIZE = 25;
export const MAX_TEST_SECONDS = 20 * 60;
export interface TestConcept { id: string; heldOut: boolean; mastery: number; taught: boolean }
export interface TestItem {
  id: string; conceptId: string; isTransfer: boolean; answerKind: string | null; type: ItemType;
}
export class TestAssemblyError extends Error {}

/** Conservative format budgets, including reading and the confidence tap. */
export function estimatedSeconds(item: TestItem): number {
  if (item.answerKind === 'graphBuild') return 90;
  if (item.type === 'explain' || item.type === 'application') return 45;
  return 30;
}

export function assertTestAssembly(selected: TestItem[], concepts: TestConcept[]): void {
  const transfers = selected.filter((i) => i.isTransfer).length;
  if (selected.length < 25 || selected.length > 30 || new Set(selected.map((i) => i.id)).size !== selected.length)
    throw new TestAssemblyError('A cold test needs 25–30 distinct items');
  if (transfers < 3 || transfers > 5) throw new TestAssemblyError('A cold test needs 3–5 transfer items');
  if (concepts.some((c) => c.heldOut && !selected.some((i) => i.conceptId === c.id && !i.isTransfer)))
    throw new TestAssemblyError('Every held-out concept needs a question');
  if (selected.some((i) => !isPopupEligible(i.answerKind))) throw new TestAssemblyError('Ineligible test format');
  if (selected.filter((i) => i.answerKind === 'graphBuild').length > 1)
    throw new TestAssemblyError('At most one graphBuild per test');
  if (selected.reduce((sum, i) => sum + estimatedSeconds(i), 0) >= MAX_TEST_SECONDS)
    throw new TestAssemblyError('Cold test must take less than 20 minutes');
  if (selected.some((i) => !concepts.some((c) => c.id === i.conceptId && (c.heldOut || c.taught))))
    throw new TestAssemblyError('An untaught treatment concept cannot be scored as taught');
}

/** Stratify by predicted recall, rotating concepts within each stratum before
 * taking a second question from one concept. The caller filters recent and
 * retired items in SQL. Randomisation happens once; itemIds persist the order. */
export function assembleTest(concepts: TestConcept[], candidates: TestItem[], rng = Math.random): TestItem[] {
  const shuffled = <T>(rows: T[]): T[] => rows.map((row) => ({ row, key: rng() }))
    .sort((a, b) => a.key - b.key).map(({ row }) => row);
  const pool = shuffled(candidates.filter((i) => isPopupEligible(i.answerKind)));
  const selected: TestItem[] = [];
  const usable = (i: TestItem) => !selected.some((s) => s.id === i.id)
    && (i.answerKind !== 'graphBuild' || !selected.some((s) => s.answerKind === 'graphBuild'))
    && selected.reduce((sum, s) => sum + estimatedSeconds(s), estimatedSeconds(i)) < MAX_TEST_SECONDS;
  for (const concept of concepts.filter((c) => c.heldOut)) {
    const item = pool.find((i) => i.conceptId === concept.id && !i.isTransfer && usable(i));
    if (!item) throw new TestAssemblyError(`Missing eligible held-out question: ${concept.id}`);
    selected.push(item);
  }
  const taught = concepts.filter((c) => !c.heldOut && c.taught);
  const strata = [0, 1, 2].map((band) => shuffled(taught.filter((c) => Math.min(2, Math.floor(c.mastery * 3)) === band)));
  const ordered: TestConcept[] = [];
  for (let index = 0; strata.some((s) => index < s.length); index++) {
    for (const stratum of strata) { const c = stratum[index]; if (c) ordered.push(c); }
  }
  // Transfer is a separate measurement category, drawn from taught concepts.
  for (const concept of ordered) {
    if (selected.filter((i) => i.isTransfer).length === 4) break;
    const item = pool.find((i) => i.conceptId === concept.id && i.isTransfer && usable(i));
    if (item) selected.push(item);
  }
  if (selected.filter((i) => i.isTransfer).length < 3) throw new TestAssemblyError('Insufficient eligible transfer questions');
  while (selected.length < TEST_SIZE) {
    const before = selected.length;
    for (const concept of ordered) {
      if (selected.length === TEST_SIZE) break;
      const item = pool.find((i) => i.conceptId === concept.id && !i.isTransfer && usable(i));
      if (item) selected.push(item);
    }
    if (selected.length === before) throw new TestAssemblyError('Insufficient eligible questions for a complete cold test');
  }
  assertTestAssembly(selected, concepts);
  return shuffled(selected);
}

export interface ScoredAnswer { conceptId: string; correct: boolean; confidence: NonNullable<Confidence>; heldOut: boolean; isTransfer: boolean }
const confidenceValue = { guess: 0.33, think: 0.66, sure: 1 } as const;
export function scoreTest(answers: ScoredAnswer[]): TestScores {
  if (!answers.length) throw new TestAssemblyError('Cannot score an empty test');
  const fraction = (rows: ScoredAnswer[]) => rows.length ? rows.filter((r) => r.correct).length / rows.length : null;
  const overall = fraction(answers)!;
  return {
    overall,
    // Disjoint categories: transfer is scored separately from direct recall.
    taught: fraction(answers.filter((a) => !a.heldOut && !a.isTransfer)),
    heldOut: fraction(answers.filter((a) => a.heldOut)),
    transfer: fraction(answers.filter((a) => a.isTransfer)),
    calibrationGap: answers.reduce((sum, a) => sum + confidenceValue[a.confidence], 0) / answers.length - overall,
    perConcept: Object.fromEntries([...new Set(answers.map((a) => a.conceptId))]
      .map((id) => [id, fraction(answers.filter((a) => a.conceptId === id))!])),
  };
}
