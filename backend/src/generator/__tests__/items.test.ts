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

const fixtureText = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/items.usestate.json'),
  'utf8',
);
const fixture = JSON.parse(fixtureText);

const asText = (text: string, finishReason = 'stop') => ({
  choices: [{ message: { content: text }, finish_reason: finishReason }],
});

beforeEach(() => create.mockReset());

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
