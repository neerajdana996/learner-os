import { describe, expect, it } from 'vitest';
import { collectUsage, estimateUsd, recordUsage, type CallRecord } from '../usage.js';

const call = (over: Partial<CallRecord> = {}): CallRecord => ({
  prompt_name: 'items',
  model: 'gpt-5.6-luna',
  ms: 900,
  prompt: 1000,
  completion: 2000,
  reasoning: 0,
  usd: 0,
  ...over,
});

describe('estimateUsd', () => {
  it('prices input and output separately', () => {
    // luna is $0.20 / $1.20 per million.
    expect(estimateUsd('gpt-5.6-luna', { prompt: 1_000_000, completion: 0, reasoning: 0 })).toBeCloseTo(0.2);
    expect(estimateUsd('gpt-5.6-luna', { prompt: 0, completion: 1_000_000, reasoning: 0 })).toBeCloseTo(1.2);
    expect(estimateUsd('gpt-5.6-sol', { prompt: 500_000, completion: 100_000, reasoning: 0 })).toBeCloseTo(4);
  });

  it('reports an unknown model as 0 rather than throwing', () => {
    // A price table that can fail a generation is worse than one that
    // under-reports a log line.
    expect(estimateUsd('some-new-model', { prompt: 10_000, completion: 10_000, reasoning: 0 })).toBe(0);
  });
});

describe('collectUsage', () => {
  it('collects the calls made inside it and totals the cost', async () => {
    const { result, calls, usd } = await collectUsage(async () => {
      recordUsage(call({ usd: 0.01 }));
      recordUsage(call({ usd: 0.02, prompt_name: 'teaching' }));
      return 'done';
    });

    expect(result).toBe('done');
    expect(calls).toHaveLength(2);
    expect(usd).toBeCloseTo(0.03);
  });

  it('ignores calls made outside it', async () => {
    recordUsage(call());
    const { calls } = await collectUsage(async () => 'x');
    expect(calls).toHaveLength(0);
  });

  it('stops collecting when the run throws, and still releases the collector', async () => {
    await expect(
      collectUsage(async () => {
        recordUsage(call());
        throw new Error('generation failed');
      }),
    ).rejects.toThrow('generation failed');

    // A leaked collector would attribute the next job's calls to a dead one.
    const { calls } = await collectUsage(async () => 'x');
    expect(calls).toHaveLength(0);
  });

  it('refuses to overlap two collections rather than interleaving them', async () => {
    await collectUsage(async () => {
      await expect(collectUsage(async () => 'inner')).rejects.toThrow('already collecting');
    });
  });
});
