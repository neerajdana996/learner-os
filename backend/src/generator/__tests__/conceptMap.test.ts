import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock at the SDK boundary (openai.chat.completions.create) so the real
// complete() → stripFences → JSON.parse → Zod → graph-validation pipeline runs,
// and "called twice" assertions count actual model calls.
const create = vi.fn();
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create } };
  },
}));

const { generateConceptMap, validateConceptMap, parseConceptMapResponse, ConceptMapSchema, GenerationError } =
  await import('../conceptMap.js');

const fixtureText = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/conceptMap.react-hooks.json'),
  'utf8',
);
const fixture = JSON.parse(fixtureText);

const asText = (text: string, finishReason = 'stop') => ({
  choices: [{ message: { content: text }, finish_reason: finishReason }],
});

/** Structurally valid map, small enough to sit under MIN_CONCEPTS. */
const smallMap = {
  topic: 'React Hooks',
  concepts: [
    { slug: 'a', title: 'A', summary: 'a', prereqs: [] },
    { slug: 'b', title: 'B', summary: 'b', prereqs: ['a'] },
  ],
};

beforeEach(() => create.mockReset());

describe('concept map generation', () => {
  it('fixture round-trips through ConceptMapSchema.parse', () => {
    expect(() => ConceptMapSchema.parse(fixture)).not.toThrow();
  });

  it('parses the fixture and returns 20+ concepts in one model call', async () => {
    create.mockResolvedValueOnce(asText(fixtureText));
    const result = await generateConceptMap('React Hooks');
    expect(result.concepts.length).toBeGreaterThanOrEqual(20);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('parses a response wrapped in ```json fences', async () => {
    create.mockResolvedValueOnce(asText(`Here you go:\n\`\`\`json\n${fixtureText}\n\`\`\``));
    const result = await generateConceptMap('React Hooks');
    expect(result.concepts.length).toBeGreaterThanOrEqual(20);
  });

  it('rejects a prereq slug that does not exist', async () => {
    create.mockResolvedValueOnce(
      asText(JSON.stringify({ topic: 'X', concepts: [{ slug: 'state', title: 'S', summary: 's', prereqs: ['nope'] }] })),
    );
    await expect(generateConceptMap('X')).rejects.toMatchObject({
      name: 'GenerationError',
      reason: 'unknown_prereq',
    });
  });

  it('rejects a prereq cycle', async () => {
    create.mockResolvedValueOnce(
      asText(
        JSON.stringify({
          topic: 'X',
          concepts: [
            { slug: 'a', title: 'A', summary: 'a', prereqs: ['b'] },
            { slug: 'b', title: 'B', summary: 'b', prereqs: ['a'] },
          ],
        }),
      ),
    );
    await expect(generateConceptMap('X')).rejects.toMatchObject({ name: 'GenerationError', reason: 'cycle' });
  });

  it('rejects duplicate slugs before they hit the concepts unique index', async () => {
    create.mockResolvedValueOnce(
      asText(
        JSON.stringify({
          topic: 'X',
          concepts: [
            { slug: 'dup', title: 'A', summary: 'a', prereqs: [] },
            { slug: 'dup', title: 'B', summary: 'b', prereqs: [] },
          ],
        }),
      ),
    );
    await expect(generateConceptMap('X')).rejects.toMatchObject({
      name: 'GenerationError',
      reason: 'duplicate_slug',
    });
  });

  it('rejects a map too small to teach', async () => {
    create.mockResolvedValueOnce(asText(JSON.stringify(smallMap)));
    await expect(generateConceptMap('X')).rejects.toMatchObject({
      name: 'GenerationError',
      reason: 'too_few_concepts',
    });
  });

  it('retries once when the first response is not JSON, then resolves', async () => {
    create.mockResolvedValueOnce(asText('sorry, here is your map!')).mockResolvedValueOnce(asText(fixtureText));
    const result = await generateConceptMap('React Hooks');
    expect(result.concepts.length).toBeGreaterThanOrEqual(20);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('rejects with GenerationError when both attempts fail, without a third call', async () => {
    create.mockResolvedValue(asText('not json'));
    await expect(generateConceptMap('X')).rejects.toMatchObject({
      name: 'GenerationError',
      reason: 'invalid_json',
    });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('does not retry a truncated response', async () => {
    create.mockResolvedValue(asText(`{"topic":"X","concepts":[`, 'length'));
    await expect(generateConceptMap('X')).rejects.toMatchObject({
      name: 'GenerationError',
      reason: 'truncated',
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('validateConceptMap and parseConceptMapResponse work on raw input', () => {
    expect(validateConceptMap(smallMap).concepts).toHaveLength(2);
    expect(parseConceptMapResponse(`\`\`\`json\n${JSON.stringify(smallMap)}\n\`\`\``).concepts).toHaveLength(2);
    expect(() => validateConceptMap({ topic: 'X', concepts: [{ slug: 'a', title: 'A', summary: 'a', prereqs: ['x'] }] }))
      .toThrow(GenerationError);
  });
});
