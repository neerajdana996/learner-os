import { describe, expect, it } from 'vitest';
import { shuffleOptions } from '../items.js';
import { seededRng } from '../../lib/heldOut.js';
import type { GeneratedItem } from '../items.js';

const recognition = (answerIndex = 0): GeneratedItem => ({
  isTransfer: false,
  payload: {
    type: 'recognition',
    prompt: 'Which situation is a network partition?',
    options: ['correct', 'wrong one', 'wrong two', 'wrong three'],
    answerIndex,
  },
});

describe('shuffleOptions (T-121)', () => {
  it('keeps answerIndex pointing at the same text', () => {
    const item = recognition(0);
    const shuffled = shuffleOptions(item, seededRng(7));
    const payload = shuffled.payload as Extract<typeof shuffled.payload, { type: 'recognition' }>;

    expect(payload.options[payload.answerIndex]).toBe('correct');
    expect([...payload.options].sort()).toEqual([...['correct', 'wrong one', 'wrong two', 'wrong three']].sort());
  });

  it('spreads the answer across all four positions', () => {
    // The measured bias this exists for: index 1 was correct in 52.3% of the
    // 369 real items and index 3 in 1.4% — five items out of 369. Always
    // answering "B" scored 52% without reading the question.
    const rng = seededRng(1);
    const positions = new Set<number>();
    for (let i = 0; i < 60; i += 1) {
      const shuffled = shuffleOptions(recognition(0), rng);
      const payload = shuffled.payload as Extract<typeof shuffled.payload, { type: 'recognition' }>;
      positions.add(payload.answerIndex);
    }

    expect(positions).toEqual(new Set([0, 1, 2, 3]));
  });

  it('leaves every other item type untouched', () => {
    const item: GeneratedItem = {
      isTransfer: false,
      payload: { type: 'recall', prompt: 'What is a replica?', answer: 'a copy', accept: [] },
    };

    expect(shuffleOptions(item, seededRng(3))).toEqual(item);
  });

  it('follows the answer when it did not start at zero', () => {
    const shuffled = shuffleOptions(recognition(2), seededRng(11));
    const payload = shuffled.payload as Extract<typeof shuffled.payload, { type: 'recognition' }>;

    expect(payload.options[payload.answerIndex]).toBe('wrong two');
  });

  it('picks the right one when two options share text', () => {
    // Located by original index rather than string equality — matching on text
    // would silently point at the duplicate.
    const item: GeneratedItem = {
      isTransfer: false,
      payload: {
        type: 'recognition',
        prompt: 'p',
        options: ['same', 'same', 'b', 'c'],
        answerIndex: 1,
      },
    };

    const shuffled = shuffleOptions(item, seededRng(5));
    const payload = shuffled.payload as Extract<typeof shuffled.payload, { type: 'recognition' }>;
    expect(payload.options[payload.answerIndex]).toBe('same');
    expect(payload.options).toHaveLength(4);
  });
});
