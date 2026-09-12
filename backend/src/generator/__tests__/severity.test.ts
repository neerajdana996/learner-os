import { describe, expect, it } from 'vitest';
import { GenerationError, type GenerationErrorReason } from '../errors.js';
import { REPAIRABLE_REASONS, isRepairable, failer, collectWarnings } from '../severity.js';

/**
 * Every reason, classified deliberately (T-164).
 *
 * Written as an exhaustive table rather than a spot check so the compiler is
 * the thing that catches an unclassified reason: adding one to the union
 * without adding it here fails `pnpm lint`, which is the only moment anyone is
 * guaranteed to think about whether it should be able to end a course.
 */
const CLASSIFIED: Record<GenerationErrorReason, 'integrity' | 'preference'> = {
  // Transport and shape: nothing usable came back.
  invalid_json: 'integrity',
  invalid_shape: 'integrity',
  truncated: 'integrity',
  refused: 'integrity',
  missing_api_key: 'integrity',

  // Concept map — the graph has to be a graph.
  duplicate_slug: 'integrity',
  unknown_prereq: 'integrity',
  cycle: 'integrity',
  too_few_concepts: 'integrity',
  unknown_crux: 'integrity',
  unknown_capability: 'integrity',
  // ...but its proportions are preferences.
  crux_count: 'preference',
  thin_crux: 'preference',
  too_many_prereqs: 'preference',
  chain_too_deep: 'preference',
  too_few_roots: 'preference',
  capability_unserved: 'preference',

  // Items — unanswerable, ungradable, or answer-leaking is fatal.
  missing_item_type: 'integrity',
  explain_rubric: 'integrity',
  dangling_reference: 'integrity',
  batch_slug_mismatch: 'integrity',
  duplicate_prompt: 'integrity',
  item_cues_another: 'integrity',
  // ...counts are not.
  transfer_count: 'preference',
  too_few_items: 'preference',
  too_many_rich: 'preference',

  // Teaching — a thinner lesson, not an unteachable one.
  corrections_count: 'preference',
  explanation_not_expanded: 'preference',
};

describe('rule severity', () => {
  it('classifies every reason, and REPAIRABLE_REASONS is exactly the preferences', () => {
    const expected = Object.entries(CLASSIFIED)
      .filter(([, kind]) => kind === 'preference')
      .map(([reason]) => reason)
      .sort();

    expect([...REPAIRABLE_REASONS].sort()).toEqual(expected);
  });

  it('treats an unknown or non-GenerationError failure as fatal', () => {
    expect(isRepairable(new Error('boom'))).toBe(false);
    expect(isRepairable(new GenerationError('cycle', 'c1 → c2 → c1'))).toBe(false);
    expect(isRepairable(new GenerationError('transfer_count', 'none marked'))).toBe(true);
  });
});

describe('failer', () => {
  it('throws every reason when not tolerating', async () => {
    const fail = failer('items');
    expect(() => fail('transfer_count', 'none marked')).toThrow(/transfer_count/);
    expect(() => fail('cycle', 'c1 → c2 → c1')).toThrow(/cycle/);
  });

  it('records a preference rule instead of throwing, naming the stage', async () => {
    const { warnings } = await collectWarnings(async () => {
      failer('items', true)('transfer_count', 'concept c1: none marked');
    });

    expect(warnings).toEqual([
      { reason: 'transfer_count', prompt: 'items', message: 'concept c1: none marked' },
    ]);
  });

  // The flag says "tolerate what is tolerable", not "skip the checks". A caller
  // cannot opt out of integrity by passing it.
  it('still throws an integrity rule even when tolerating', async () => {
    await collectWarnings(async () => {
      expect(() => failer('items', true)('dangling_reference', 'points at a listing it does not carry')).toThrow(
        /dangling_reference/,
      );
    });
  });

  it('refuses to collect two generations at once', async () => {
    await collectWarnings(async () => {
      await expect(collectWarnings(async () => undefined)).rejects.toThrow(/already collecting/);
    });
  });
});
