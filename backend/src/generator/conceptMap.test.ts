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

const { generateConceptMap, parseConceptMapResponse, GenerationError, validateConceptMap } = await import('./conceptMap.js');

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/conceptMap.react-hooks.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

beforeEach(() => {
  promptStub.mockReset();
});

describe('concept map generation', () => {
  it('fixture parses and returns at least 20 concepts', async () => {
    promptStub.mockResolvedValueOnce(fixture);
    const result = await generateConceptMap('React Hooks');
    expect(result.concepts.length).toBeGreaterThanOrEqual(20);
    expect(result.concepts.every((c) => c.prereqs.every((p) => result.concepts.some((x) => x.slug === p)))).toBe(true);
  });

  it('parses fenced json responses', () => {
    const raw = `\n\`\`\`json\n${JSON.stringify(fixture)}\n\`\`\`\n`;
    expect(parseConceptMapResponse(raw).concepts.length).toBeGreaterThanOrEqual(20);
  });

  it('rejects unknown prereqs', () => {
    const bad = {
      topic: 'React Hooks',
      concepts: [{ slug: 'state', title: 'State', summary: 'A', prereqs: ['nope'] }],
    };
    expect(() => validateConceptMap(bad)).toThrow(GenerationError);
    expect(() => validateConceptMap(bad)).toThrowError(/unknown_prereq/);
  });

  it('rejects cycles', () => {
    const bad = {
      topic: 'React Hooks',
      concepts: [
        { slug: 'a', title: 'A', summary: 'A', prereqs: ['b'] },
        { slug: 'b', title: 'B', summary: 'B', prereqs: ['a'] },
      ],
    };
    expect(() => validateConceptMap(bad)).toThrow(GenerationError);
    expect(() => validateConceptMap(bad)).toThrowError(/cycle/);
  });

  it('retries once on garbage, then succeeds', async () => {
    promptStub.mockRejectedValueOnce(new Error('bad json')).mockResolvedValueOnce(fixture);
    await expect(generateConceptMap('React Hooks')).resolves.toMatchObject({ topic: 'React Hooks' });
    expect(promptStub).toHaveBeenCalledTimes(2);
  });

  it('throws GenerationError when both attempts fail', async () => {
    promptStub.mockRejectedValue(new Error('broken'));
    await expect(generateConceptMap('React Hooks')).rejects.toMatchObject({ name: 'GenerationError' });
    expect(promptStub).toHaveBeenCalledTimes(2);
  });
});
