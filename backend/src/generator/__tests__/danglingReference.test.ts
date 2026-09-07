import { describe, expect, it } from 'vitest';
import { REFERS_TO_SHOWN, validateItems, GenerationError } from '../items.js';

/** A minimal valid set: all four types, one transfer. `unknown[]` because
 *  `validateItems` takes raw model output — narrowing it here would only be
 *  asserting the shape the function exists to check. */
const baseItems = (): Record<string, unknown>[] => [
  { type: 'recall', prompt: 'What is a replica?', answer: 'a copy', accept: [], isTransfer: false },
  {
    type: 'recognition',
    prompt: 'Which situation is a network partition?',
    options: ['a', 'b', 'c', 'd'],
    answerIndex: 1,
    isTransfer: false,
  },
  { type: 'application', prompt: 'Node A and node B both store X. What is B?', answer: 'a replica', accept: [], isTransfer: true },
  { type: 'explain', prompt: 'Explain why partitions split a cluster.', rubric: 'names the two groups', isTransfer: false },
];

const withPrompt = (prompt: string) => {
  const items = baseItems();
  items[0] = { ...items[0], prompt };
  return { topic: 'Distributed systems', items };
};

describe('REFERS_TO_SHOWN', () => {
  it('catches a reference to an artefact that should be attached', () => {
    expect(REFERS_TO_SHOWN.test('Which operations overlap in the history shown?')).toBe(true);
    expect(REFERS_TO_SHOWN.test('In the diagram, which node is the leader?')).toBe(true);
    expect(REFERS_TO_SHOWN.test('What does the code below print?')).toBe(true);
  });

  it('leaves ordinary prose alone', () => {
    // A looser rule would reject all of these, costing good items to catch a
    // rare bad one.
    expect(REFERS_TO_SHOWN.test('Which of the following is a window state?')).toBe(false);
    expect(REFERS_TO_SHOWN.test('The recurrence adds the cell above and the cell to the left.')).toBe(false);
    expect(REFERS_TO_SHOWN.test('No Provider is anywhere above it in the tree.')).toBe(false);
    expect(REFERS_TO_SHOWN.test('What must be shown to prove the property?')).toBe(false);
  });
});

describe('validateItems rejects a dangling reference (T-125)', () => {
  it('throws when a prompt points at a history the item does not carry', () => {
    // No item in the database violates this today — the rule is preventive.
    // The failure it guards against is unanswerable when it happens, and one
    // unanswerable question makes a learner distrust every other one.
    expect(() => validateItems(withPrompt('Which operations overlap in the history shown?')))
      .toThrow(GenerationError);
  });

  it('names the reason so a retry can act on it', () => {
    try {
      validateItems(withPrompt('What does the code below print?'));
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as GenerationError).reason).toBe('dangling_reference');
    }
  });

  it('allows the same prompt when the item actually carries a block', () => {
    const items = baseItems();
    items[0] = {
      ...items[0],
      prompt: 'What does the code below print?',
      blocks: [{ kind: 'code', slot: 'context', lang: 'javascript', src: 'console.log(1)', short: null, notes: [], dim: null }],
    };

    expect(() => validateItems({ topic: 'JS', items })).not.toThrow();
  });

  it('accepts an ordinary set unchanged', () => {
    expect(() => validateItems(withPrompt('What is a replica?'))).not.toThrow();
  });
});
