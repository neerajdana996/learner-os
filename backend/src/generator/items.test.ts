import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const promptStub = vi.fn();
vi.mock('../llm/index.js', () => ({
  runPrompt: (...args: unknown[]) => promptStub(...args),
  definePrompt: (def: unknown) => def,
  stripFences: (text: string) => {
    const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
    return (match?.[1] ?? text).trim();
  },
}));

const { generateItems, GenerationError, validateItems } = await import('./items.js');

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/items.usestate.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

beforeEach(() => {
  promptStub.mockReset();
});

describe('items generation', () => {
  it('fixture parses and contains all four types', async () => {
    promptStub.mockResolvedValueOnce(fixture);
    const result = await generateItems('useState');
    expect(result.items.length).toBeGreaterThan(0);
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

  it('retries once on garbage, then succeeds', async () => {
    promptStub.mockRejectedValueOnce(new Error('bad json')).mockResolvedValueOnce(fixture);
    await expect(generateItems('useState')).resolves.toMatchObject({ topic: 'useState' });
    expect(promptStub).toHaveBeenCalledTimes(2);
  });

  it('throws GenerationError when both attempts fail', async () => {
    promptStub.mockRejectedValue(new Error('broken'));
    await expect(generateItems('useState')).rejects.toMatchObject({ name: 'GenerationError' });
    expect(promptStub).toHaveBeenCalledTimes(2);
  });
});
