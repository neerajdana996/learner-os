import { describe, expect, it } from 'vitest';
import { assembleTest, assertTestAssembly, estimatedSeconds, scoreTest, type ScoredAnswer, type TestConcept, type TestItem } from '../testGen.js';
import { seededRng } from '../heldOut.js';

function pool() {
  const concepts: TestConcept[] = Array.from({ length: 17 }, (_, i) => ({
    id: `c${i}`, heldOut: i >= 15, taught: i < 15, mastery: (i % 3) / 3 + 0.1,
  }));
  const items: TestItem[] = concepts.flatMap((c) => Array.from({ length: c.heldOut ? 1 : 5 }, (_, i) => ({
    id: `${c.id}-${i}`, conceptId: c.id, isTransfer: i === 4, answerKind: null, type: 'recall' as const,
  })));
  return { concepts, items };
}
describe('cold test assembly', () => {
  it('includes every control and all mastery strata with four transfers in under 20 minutes', () => {
    const { concepts, items } = pool();
    const selected = assembleTest(concepts, items, seededRng(7));
    expect(selected).toHaveLength(25);
    expect(selected.filter((i) => i.isTransfer)).toHaveLength(4);
    expect(selected.reduce((sum, i) => sum + estimatedSeconds(i), 0)).toBeLessThan(1200);
    for (const concept of concepts) expect(selected.some((i) => i.conceptId === concept.id)).toBe(true);
  });
  it('rejects a missing control or insufficient items instead of publishing a partial instrument', () => {
    const { concepts, items } = pool();
    expect(() => assembleTest(concepts, items.filter((i) => i.conceptId !== 'c16'))).toThrow(/held-out/);
    expect(() => assembleTest(concepts, items.filter((i) => i.id.endsWith('-0') || i.isTransfer))).toThrow(/Insufficient/);
  });
  it('never uses an untaught treatment concept or a long format to fill the sample', () => {
    const { concepts, items } = pool();
    concepts[0]!.taught = false;
    const selected = assembleTest(concepts, [...items, { ...items[0]!, id: 'editor', answerKind: 'codeEditor' }]);
    expect(selected.some((i) => i.conceptId === 'c0' || i.id === 'editor')).toBe(false);
  });
  it('rejects two graphBuild questions and an oversized time budget', () => {
    const { concepts, items } = pool();
    const selected = assembleTest(concepts, items);
    selected[0]!.answerKind = 'graphBuild';
    selected[1]!.answerKind = 'graphBuild';
    expect(() => assertTestAssembly(selected, concepts)).toThrow(/At most one/);
    selected.forEach((i) => { i.answerKind = null; i.type = 'explain'; });
    selected.push({ ...selected[0]!, id: 'extra1' }, { ...selected[0]!, id: 'extra2' });
    expect(() => assertTestAssembly(selected, concepts)).toThrow(/20 minutes/);
  });
});
describe('cold test scores', () => {
  it('scores direct taught 8/10, controls 1/5, transfer 2/4 and confidence independently', () => {
    const answers: ScoredAnswer[] = [
      ...Array.from({ length: 10 }, (_, i) => ({ conceptId: 'taught', heldOut: false, isTransfer: false, correct: i < 8, confidence: 'sure' as const })),
      ...Array.from({ length: 5 }, (_, i) => ({ conceptId: 'control', heldOut: true, isTransfer: false, correct: i < 1, confidence: 'guess' as const })),
      ...Array.from({ length: 4 }, (_, i) => ({ conceptId: 'transfer', heldOut: false, isTransfer: true, correct: i < 2, confidence: 'think' as const })),
    ];
    const scores = scoreTest(answers);
    expect(scores.taught).toBe(0.8);
    expect(scores.heldOut).toBe(0.2);
    expect(scores.transfer).toBe(0.5);
    expect(scores.overall).toBe(11 / 19);
    expect(scores.calibrationGap).toBeCloseTo((10 + 5 * .33 + 4 * .66) / 19 - 11 / 19);
    expect(scores.perConcept).toEqual({ taught: .8, control: .2, transfer: .5 });
  });
});
