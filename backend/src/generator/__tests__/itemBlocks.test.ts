/**
 * The rich-format upgrade pass (T-166).
 *
 * The model half of this is settled by measurement, not by tests: a batch of
 * four concepts produced zero blocks in 187 items across two full generations,
 * and this shape produced an upgrade in four runs out of four. What a test can
 * protect is everything *around* that — the guard rails that decide what a
 * reply is allowed to change, and the promise that a failed upgrade can never
 * cost a course that is already complete.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create } };
  },
}));

const { enrichConceptItems } = await import('../itemBlocks.js');
type GeneratedItem = import('../items.js').GeneratedItem;
const { collectWarnings } = await import('../severity.js');

const asText = (value: unknown) => ({
  choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }],
});

const plain = (prompt: string, isTransfer = false): GeneratedItem => ({
  payload: { type: 'recall' as const, prompt, answer: 'the answer', accept: [] },
  isTransfer,
});

const input = (items = [plain('One'), plain('Two'), plain('Three')]) => ({
  topic: 'Binary search',
  level: 'intermediate',
  spine: 'one sorted array of ten integers',
  concept: 'Exclusive upper bound',
  summary: 'the window is half-open',
  language: 'JavaScript',
  items,
});

/** A valid upgrade of item `n` — a boundary rule as a cloze, the shape the
 *  decision list's first entry asks for. */
const upgrade = (replaces: number, prompt = 'Complete the loop condition.') => ({
  replaces,
  item: {
    type: 'recall',
    prompt,
    answer: 'lo < hi',
    accept: ['lo<hi'],
    isTransfer: false,
    blocks: [
      {
        kind: 'clozeCode',
        slot: 'answer',
        lang: 'javascript',
        src: 'while ({{1}}) {',
        holes: [{ id: 1, answer: 'lo < hi', accept: ['lo<hi'], width: 8 }],
        failure: 'With `lo <= hi` the loop reads a[a.length] on the last step.',
      },
    ],
  },
});

beforeEach(() => {
  create.mockReset();
});

describe('upgrading a concept\'s items', () => {
  it('replaces only the item it names, leaving the rest untouched', async () => {
    create.mockResolvedValue(asText({ upgrades: [upgrade(2)] }));

    const { items } = await enrichConceptItems(input());

    expect(items).toHaveLength(3);
    expect(items[0]?.payload.prompt).toBe('One');
    expect(items[2]?.payload.prompt).toBe('Three');
    expect(items[1]?.payload.blocks?.[0]?.kind).toBe('clozeCode');
  });

  it('returns the items unchanged when nothing qualifies', async () => {
    // An empty list is a correct answer, not a failure: about half of code
    // concepts are answered in a sentence.
    create.mockResolvedValue(asText({ upgrades: [] }));

    const { items, warning } = await enrichConceptItems(input());

    expect(warning).toBeUndefined();
    expect(items.map((i) => i.payload.prompt)).toEqual(['One', 'Two', 'Three']);
  });

  /**
   * A transfer item applies the idea in a setting it was *not* taught in, so a
   * blank cut into the taught listing is not transfer whatever it is labelled.
   * `isTransfer` is a measured outcome, so this is enforced here rather than
   * trusted to the prompt.
   */
  it('never upgrades a transfer item, however the model labels the replacement', async () => {
    create.mockResolvedValue(asText({ upgrades: [upgrade(2)] }));

    const { items } = await enrichConceptItems(input([plain('One'), plain('Two', true)]));

    expect(items[1]?.payload.prompt).toBe('Two');
    expect(items[1]?.payload.blocks).toBeFalsy();
  });

  it('drops an upgrade that changes the item type, and keeps the others', async () => {
    // Changing the type changes what is measured, not how it is asked.
    const retyped = upgrade(1);
    retyped.item.type = 'application';
    create.mockResolvedValue(asText({ upgrades: [retyped, upgrade(3, 'Still fine.')] }));

    const { items } = await enrichConceptItems(input());

    expect(items[0]?.payload.prompt).toBe('One');
    expect(items[2]?.payload.blocks?.[0]?.kind).toBe('clozeCode');
  });

  it('ignores a replaces that names no item', async () => {
    create.mockResolvedValue(asText({ upgrades: [upgrade(9)] }));

    const { items } = await enrichConceptItems(input());

    expect(items.map((i) => i.payload.prompt)).toEqual(['One', 'Two', 'Three']);
  });

  /**
   * The promise this pass is built on. It runs against a course that is already
   * complete — every item answerable, nineteen calls and six minutes already
   * spent — so the only thing a failure may cost is that two questions stay
   * plain. It must never be able to end a topic.
   */
  it('survives a failed call, returning the original items and a warning', async () => {
    create.mockRejectedValue(new Error('upstream exploded'));

    const { warnings, result } = await collectWarnings(async () => enrichConceptItems(input()));

    expect(result.items.map((i) => i.payload.prompt)).toEqual(['One', 'Two', 'Three']);
    expect(result.warning).toBeDefined();
    expect(warnings).toEqual([]); // the caller records it, not this function
  });

  it('survives a reply whose upgrade is not a storable item', async () => {
    create.mockResolvedValue(asText({ upgrades: [{ replaces: 1, item: { type: 'recall' } }] }));

    const { items } = await enrichConceptItems(input());

    expect(items.map((i) => i.payload.prompt)).toEqual(['One', 'Two', 'Three']);
  });
});
