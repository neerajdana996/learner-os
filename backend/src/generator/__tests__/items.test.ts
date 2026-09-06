import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocked at the SDK boundary, same as conceptMap.test.ts, so the real
// complete() → stripFences → JSON.parse → Zod → rule-validation path runs.
const create = vi.fn();
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create } };
  },
}));

const { generateItems, validateItems, GenerationError } = await import('../items.js');

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures');
const fixtureText = readFileSync(join(fixtures, 'items.usestate.json'), 'utf8');
const fixture = JSON.parse(fixtureText);
/** T-083 — a real-looking code concept: 8 items, 2 rich, 1 transfer. */
const codeFixtureText = readFileSync(join(fixtures, 'items.binary-search-bound.json'), 'utf8');

const asText = (text: string, finishReason = 'stop') => ({
  choices: [{ message: { content: text }, finish_reason: finishReason }],
});

beforeEach(() => create.mockReset());

// T-083 — the fixture is the acceptance criterion made runnable: it has to
// survive the whole pipeline, including the block resolution and every
// superRefine rule T-080 wrote.
describe('the code-item fixture', () => {
  const generate = () =>
    generateItems({
      topic: 'Binary search',
      concept: 'Exclusive upper bound',
      summary: 'hi holds one past the last index.',
      domain: 'code',
    });

  it('parses end to end, with line quotes resolved into line numbers', async () => {
    create.mockResolvedValueOnce(asText(codeFixtureText));
    const result = await generate();

    expect(result.items).toHaveLength(8);
    expect(new Set(result.items.map((i) => i.payload.type))).toEqual(
      new Set(['recall', 'recognition', 'application', 'explain']),
    );

    const noted = result.items
      .flatMap((i) => i.payload.blocks ?? [])
      .find((b): b is Extract<typeof b, { kind: 'code' }> => b.kind === 'code' && b.notes.length > 0);
    // "let hi = a.length;" is the third line — resolved from the quote, never
    // sent as a number.
    expect(noted?.notes[0]?.line).toBe(3);
  });

  it('keeps rich formats to two, and the rest plain', async () => {
    create.mockResolvedValueOnce(asText(codeFixtureText));
    const result = await generate();

    const rich = result.items.filter((i) => i.payload.blocks?.some((b) => b.slot === 'answer'));
    expect(rich).toHaveLength(2);
    expect(rich.map((i) => i.payload.blocks?.find((b) => b.slot === 'answer')?.kind).sort()).toEqual([
      'clozeCode',
      'hotspotLine',
    ]);
  });

  it('marks its transfer item plain, not rich', async () => {
    create.mockResolvedValueOnce(asText(codeFixtureText));
    const result = await generate();

    // A blank cut into the listing the concept was taught with is a second
    // attempt, not transfer — and `isTransfer` is a measured outcome.
    const transfer = result.items.filter((i) => i.isTransfer);
    expect(transfer).toHaveLength(1);
    expect(transfer[0]?.payload.blocks).toBeUndefined();
  });

  it('rejects a third rich item rather than storing it', async () => {
    const doc = JSON.parse(codeFixtureText);
    // Turn the plain recall into a third cloze.
    doc.items[0].blocks = [
      {
        kind: 'clozeCode',
        slot: 'answer',
        lang: 'javascript',
        src: 'let hi = a.{{1}};',
        holes: [{ id: 1, answer: 'length', accept: [], width: 6 }],
        failure: 'a.length - 1 skips the last element.',
      },
    ];
    create.mockResolvedValue(asText(JSON.stringify(doc)));

    await expect(generate()).rejects.toMatchObject({ name: 'GenerationError', reason: 'too_many_rich' });
  });

  it('retries once when a cloze marker has no matching hole, then succeeds', async () => {
    const broken = JSON.parse(codeFixtureText);
    const cloze = broken.items[2].blocks[1];
    cloze.src = 'while ({{1}} && {{2}}) {';

    create.mockResolvedValueOnce(asText(JSON.stringify(broken))).mockResolvedValueOnce(asText(codeFixtureText));

    const result = await generate();

    expect(result.items).toHaveLength(8);
    expect(create).toHaveBeenCalledTimes(2);
  });
});

describe('items generation', () => {
  it('parses the fixture, which contains all four types and 6+ items', async () => {
    create.mockResolvedValueOnce(asText(fixtureText));
    const result = await generateItems({ topic: 'useState', concept: 'useState', summary: 'what it covers' });
    expect(result.items.length).toBeGreaterThanOrEqual(6);
    expect(new Set(result.items.map((item) => item.payload.type))).toEqual(
      new Set(['recall', 'recognition', 'application', 'explain']),
    );
  });

  // Each case below keeps all four item types present with a valid transfer
  // count (unless that's the property under test) and an explicit isTransfer
  // on every item, so each test isolates exactly the one rule it names.
  it('rejects recognition items with only 3 options', () => {
    const bad = {
      topic: 'useState',
      items: [
        { type: 'recall', prompt: 'Q1', answer: 'A', isTransfer: true },
        { type: 'application', prompt: 'Q2', answer: 'A', isTransfer: false },
        { type: 'explain', prompt: 'Q3', rubric: 'R', isTransfer: false },
        { type: 'recognition', prompt: 'Which one?', options: ['a', 'b', 'c'], answerIndex: 1, isTransfer: false },
      ],
    };

    expect(() => validateItems(bad)).toThrow(GenerationError);
    expect(() => validateItems(bad)).toThrowError(/recognition/i);
  });

  it('rejects zero transfer items', () => {
    const bad = {
      topic: 'useState',
      items: [
        { type: 'recall', prompt: 'What is state?', answer: 'value', accept: ['value'], isTransfer: false },
        { type: 'recognition', prompt: 'Pick', options: ['a', 'b', 'c', 'd'], answerIndex: 0, isTransfer: false },
        { type: 'application', prompt: 'Apply', answer: 'A', isTransfer: false },
        { type: 'explain', prompt: 'Explain', rubric: 'R', isTransfer: false },
      ],
    };

    expect(() => validateItems(bad)).toThrow(GenerationError);
    expect(() => validateItems(bad)).toThrowError(/transfer/i);
  });

  it('rejects three transfer items', () => {
    const bad = {
      topic: 'useState',
      items: [
        { type: 'recall', prompt: 'Q1', answer: 'A', isTransfer: true },
        { type: 'recognition', prompt: 'Q2', options: ['a', 'b', 'c', 'd'], answerIndex: 0, isTransfer: true },
        { type: 'application', prompt: 'Q3', answer: 'A', isTransfer: true },
        { type: 'explain', prompt: 'Q4', rubric: 'R', isTransfer: false },
      ],
    };

    expect(() => validateItems(bad)).toThrow(GenerationError);
    expect(() => validateItems(bad)).toThrowError(/transfer/i);
  });

  it('rejects explanations longer than 200 chars', () => {
    const bad = {
      topic: 'useState',
      items: [
        { type: 'explain', prompt: 'Explain', rubric: 'a'.repeat(201), isTransfer: false },
        { type: 'recall', prompt: 'Q', answer: 'A', accept: ['A'], isTransfer: true },
        { type: 'recognition', prompt: 'Pick', options: ['a', 'b', 'c', 'd'], answerIndex: 0, isTransfer: false },
        { type: 'application', prompt: 'Apply', answer: 'A', isTransfer: false },
      ],
    };

    expect(() => validateItems(bad)).toThrow(GenerationError);
    expect(() => validateItems(bad)).toThrowError(/200|rubric|explain/i);
  });

  it('rejects a set with fewer than 6 items', async () => {
    // All four types present and exactly one transfer, so every other rule
    // passes and only the count gate can fire.
    const tooFew = {
      topic: 'useState',
      items: [
        { type: 'recall', prompt: 'Q1', answer: 'A', isTransfer: false },
        { type: 'recognition', prompt: 'Q2', options: ['a', 'b', 'c', 'd'], answerIndex: 0, isTransfer: false },
        { type: 'application', prompt: 'Q3', answer: 'A', isTransfer: false },
        { type: 'explain', prompt: 'Q4', rubric: 'R', isTransfer: true },
      ],
    };
    create.mockResolvedValueOnce(asText(JSON.stringify(tooFew)));
    await expect(generateItems({ topic: 'useState', concept: 'useState', summary: 'what it covers' })).rejects.toMatchObject({
      name: 'GenerationError',
      reason: 'too_few_items',
    });
  });

  it('retries once when the first response is not JSON, then resolves', async () => {
    create.mockResolvedValueOnce(asText('here are your questions')).mockResolvedValueOnce(asText(fixtureText));
    await expect(generateItems({ topic: 'useState', concept: 'useState', summary: 'what it covers' })).resolves.toMatchObject({ topic: 'useState' });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('rejects with GenerationError when both attempts fail, without a third call', async () => {
    create.mockResolvedValue(asText('broken'));
    await expect(generateItems({ topic: 'useState', concept: 'useState', summary: 'what it covers' })).rejects.toMatchObject({ name: 'GenerationError' });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('does not retry a truncated response', async () => {
    create.mockResolvedValue(asText('{"topic":"useState","items":[', 'length'));
    await expect(generateItems({ topic: 'useState', concept: 'useState', summary: 'what it covers' })).rejects.toMatchObject({
      name: 'GenerationError',
      reason: 'truncated',
    });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
