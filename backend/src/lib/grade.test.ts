import { beforeEach, describe, expect, it, vi } from 'vitest';

const gradeExplanation = vi.fn();
vi.mock('../generator/grade.js', () => ({
  gradeExplanation: (...a: unknown[]) => gradeExplanation(...a),
}));

const { grade, normalise } = await import('./grade.js');

const recall = (answer: string, accept?: string[]) => ({
  type: 'recall' as const,
  prompt: 'Q',
  answer,
  ...(accept ? { accept } : {}),
});

const recognition = {
  type: 'recognition' as const,
  prompt: 'Pick',
  options: ['a', 'b', 'c', 'd'],
  answerIndex: 2,
};

beforeEach(() => gradeExplanation.mockReset());

describe('normalise', () => {
  it('trims, lowercases, strips punctuation and collapses whitespace', () => {
    expect(normalise('  The   Answer. ')).toBe('the answer');
  });
});

describe('grade — recognition', () => {
  it('the correct index is true, any other index is false', async () => {
    expect((await grade(recognition, 2)).correct).toBe(true);
    expect((await grade(recognition, 0)).correct).toBe(false);
  });

  it('accepts the index as a string, as a form would send it', async () => {
    expect((await grade(recognition, '2')).correct).toBe(true);
  });

  it('names the right option when wrong, without revealing the index', async () => {
    const result = await grade(recognition, 0);
    expect(result.feedback).toContain('c');
  });
});

describe('grade — recall and application', () => {
  it('matches " The Answer. " against "the answer"', async () => {
    expect((await grade(recall('the answer'), ' The Answer. ')).correct).toBe(true);
  });

  it('matches an entry from the accept list', async () => {
    expect((await grade(recall('a hook', ['a function']), 'A FUNCTION!')).correct).toBe(true);
  });

  it('is false when nothing matches', async () => {
    const result = await grade(recall('a hook', ['a function']), 'a component');
    expect(result.correct).toBe(false);
    expect(result.feedback).toContain('a hook');
  });

  it('grades application items the same way', async () => {
    const application = { type: 'application' as const, prompt: 'Apply', answer: 'use a ref' };
    expect((await grade(application, 'Use a ref.')).correct).toBe(true);
  });
});

describe('grade — numeric tolerance', () => {
  it('accepts 3.14 for 3.1416 (within 1%)', async () => {
    expect((await grade(recall('3.1416'), '3.14')).correct).toBe(true);
  });

  it('rejects 3 for 4 (outside 1%)', async () => {
    expect((await grade(recall('4'), '3')).correct).toBe(false);
  });

  it('rejects a near miss just outside the tolerance', async () => {
    expect((await grade(recall('100'), '102')).correct).toBe(false);
    expect((await grade(recall('100'), '100.5')).correct).toBe(true);
  });

  it('falls back to absolute tolerance when the expected answer is 0', async () => {
    expect((await grade(recall('0'), '0')).correct).toBe(true);
    expect((await grade(recall('0'), '5')).correct).toBe(false);
  });

  it('still compares as text when only one side is numeric', async () => {
    expect((await grade(recall('two'), '2')).correct).toBe(false);
  });
});

describe('grade — explain', () => {
  it('defers to the LLM grader and passes the rubric and answer through', async () => {
    gradeExplanation.mockResolvedValueOnce({ correct: true, feedback: 'You covered batching.' });

    const result = await grade(
      { type: 'explain', prompt: 'Explain', rubric: 'Mentions batching' },
      'React batches updates',
    );

    expect(result).toEqual({ correct: true, feedback: 'You covered batching.' });
    expect(gradeExplanation).toHaveBeenCalledWith('Mentions batching', 'React batches updates');
  });

  it('propagates a grader failure instead of marking the answer correct', async () => {
    gradeExplanation.mockRejectedValueOnce(new Error('truncated'));

    await expect(
      grade({ type: 'explain', prompt: 'Explain', rubric: 'R' }, 'anything'),
    ).rejects.toThrow(/truncated/);
  });
});
