import { beforeEach, describe, expect, it, vi } from 'vitest';

const gradeExplanation = vi.fn();
vi.mock('../../generator/grade.js', () => ({
  gradeExplanation: (...a: unknown[]) => gradeExplanation(...a),
}));

const { grade, normalise } = await import('../grade.js');

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

describe('application items are judged, not string-matched (T-FIX-005)', () => {
  const item = {
    type: 'application' as const,
    prompt: 'The effect refetches on every render. Fix it.',
    answer: 'Add a dependency array containing userId so it only re-runs when the id changes',
    accept: [],
  };

  it('accepts a verbatim answer without spending a model call', async () => {
    gradeExplanation.mockClear();
    const result = await grade(item, item.answer);

    expect(result.correct).toBe(true);
    // The fast path exists so a correct learner never waits on the model.
    expect(gradeExplanation).not.toHaveBeenCalled();
  });

  it('accepts a correct answer phrased differently', async () => {
    gradeExplanation.mockResolvedValueOnce({
      correct: true,
      feedback: 'Right — pinning it to the id is the fix.',
    });

    const result = await grade(item, 'pass [userId] as the second arg so it only reruns when that changes');

    // String matching would have rejected this, and it counts toward the
    // retention number the pilot exists to produce.
    expect(result.correct).toBe(true);
    expect(gradeExplanation).toHaveBeenCalledTimes(1);
  });

  it('rejects a wrong answer', async () => {
    gradeExplanation.mockResolvedValueOnce({ correct: false, feedback: 'That removes the effect entirely.' });
    const result = await grade(item, 'delete the useEffect');
    expect(result.correct).toBe(false);
  });

  it('gives the grader the model answer as the rubric', async () => {
    gradeExplanation.mockResolvedValueOnce({ correct: true, feedback: 'ok' });
    await grade(item, 'something plausible');

    const [rubric] = gradeExplanation.mock.calls[0] ?? [];
    expect(rubric).toContain(item.answer);
  });

  it('propagates a grader failure rather than handing out a free pass', async () => {
    gradeExplanation.mockRejectedValueOnce(new Error('model unavailable'));
    await expect(grade(item, 'anything')).rejects.toThrow();
  });

  it('leaves recall items on the cheap path', async () => {
    gradeExplanation.mockClear();
    const recall = { type: 'recall' as const, prompt: 'q', answer: 'a ref', accept: ['useRef'] };

    expect((await grade(recall, 'useRef')).correct).toBe(true);
    expect((await grade(recall, 'a hook')).correct).toBe(false);
    // Short canonical answers never need a model call in either direction.
    expect(gradeExplanation).not.toHaveBeenCalled();
  });
});

describe('a numeric answer block', () => {
  const numericItem = (answer: number, tolerance: number, unit?: string) => ({
    type: 'recall' as const,
    prompt: 'How much memory?',
    answer: String(answer),
    blocks: [{ kind: 'numeric' as const, slot: 'answer' as const, answer, tolerance, ...(unit ? { unit } : {}) }],
  });

  /**
   * The block's own tolerance, not the fixed 1% used for text answers. A
   * capacity question wants an order of magnitude, and 1% would mark a correct
   * estimate wrong.
   */
  it('accepts an estimate inside the block’s tolerance and rejects one outside', async () => {
    const item = numericItem(6e9, 0.5, 'bytes');
    expect((await grade(item, '8000000000')).correct).toBe(true);
    expect((await grade(item, '4e9')).correct).toBe(true);
    expect((await grade(item, '20000000000')).correct).toBe(false);
  });

  it('reads the spellings that string matching could never enumerate', async () => {
    const item = numericItem(6e9, 0.1);
    for (const spelling of ['6000000000', '6e9', '6,000,000,000', ' 6000000000 ']) {
      expect((await grade(item, spelling)).correct, spelling).toBe(true);
    }
  });

  it('uses an absolute window at zero, where a relative one has none', async () => {
    const item = numericItem(0, 0.5);
    expect((await grade(item, '0.2')).correct).toBe(true);
    expect((await grade(item, '2')).correct).toBe(false);
  });

  it('says so when the answer is not a number', async () => {
    const result = await grade(numericItem(10, 0.1), 'about ten');
    expect(result.correct).toBe(false);
    expect(result.feedback).toMatch(/not a number/i);
  });

  it('names the unit in the feedback rather than demanding it in the answer', async () => {
    const result = await grade(numericItem(6e9, 0.1, 'bytes'), '1');
    expect(result.feedback).toMatch(/6000000000 bytes/);
  });
});
