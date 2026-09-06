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

const { generateConceptMap, validateConceptMap, parseConceptMapResponse, domainSplit, ConceptMapSchema, GenerationError } =
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
    { slug: 'a', title: 'A', summary: 'a', prereqs: [], domain: 'prose' as const },
    { slug: 'b', title: 'B', summary: 'b', prereqs: ['a'], domain: 'code' as const },
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
    // Domain failures retry once (T-FIX-013), so both attempts see the bad map.
    create.mockResolvedValue(
      asText(JSON.stringify({ topic: 'X', concepts: [{ slug: 'state', title: 'S', summary: 's', prereqs: ['nope'], domain: 'prose' }] })),
    );
    await expect(generateConceptMap('X')).rejects.toMatchObject({
      name: 'GenerationError',
      reason: 'unknown_prereq',
    });
  });

  it('rejects a prereq cycle', async () => {
    // Domain failures retry once (T-FIX-013), so both attempts see the bad map.
    create.mockResolvedValue(
      asText(
        JSON.stringify({
          topic: 'X',
          concepts: [
            { slug: 'a', title: 'A', summary: 'a', prereqs: ['b'], domain: 'prose' },
            { slug: 'b', title: 'B', summary: 'b', prereqs: ['a'], domain: 'prose' },
          ],
        }),
      ),
    );
    await expect(generateConceptMap('X')).rejects.toMatchObject({ name: 'GenerationError', reason: 'cycle' });
  });

  it('rejects duplicate slugs before they hit the concepts unique index', async () => {
    // Domain failures retry once (T-FIX-013), so both attempts see the bad map.
    create.mockResolvedValue(
      asText(
        JSON.stringify({
          topic: 'X',
          concepts: [
            { slug: 'dup', title: 'A', summary: 'a', prereqs: [], domain: 'prose' },
            { slug: 'dup', title: 'B', summary: 'b', prereqs: [], domain: 'prose' },
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

  // T-082 — the domain is decided here, once, rather than re-derived by forty
  // item calls that have no way to agree with each other.
  describe('domain', () => {
    const uniform = (domain: string) => ({
      topic: 'React Hooks',
      concepts: Array.from({ length: 20 }, (_, i) => ({
        slug: `c${i}`,
        title: `C${i}`,
        summary: 's',
        prereqs: [],
        domain,
      })),
    });

    it('the fixture carries a domain on every concept, and more than one kind', () => {
      // More than one kind is the part that matters: a fixture that was all
      // `code` would teach the prompt exactly the failure it exists to prevent.
      expect(fixture.concepts.every((c: { domain?: string }) => c.domain)).toBe(true);
      expect(new Set(fixture.concepts.map((c: { domain: string }) => c.domain)).size).toBeGreaterThan(1);
    });

    it('the fixture is not overwhelmingly one domain — prose clears the third the prompt asks for', () => {
      const prose = fixture.concepts.filter((c: { domain: string }) => c.domain === 'prose').length;
      expect(prose / fixture.concepts.length).toBeGreaterThanOrEqual(1 / 3);
    });

    it('rejects a map with one concept missing its domain', () => {
      const [first, ...rest] = JSON.parse(fixtureText).concepts;
      delete first.domain;
      expect(() => validateConceptMap({ topic: 'X', concepts: [first, ...rest] })).toThrow();
    });

    it('rejects an invented domain rather than storing it', () => {
      // "javascript" is the specific wrong answer to expect: it is what a model
      // classifying by *subject* reaches for.
      expect(() => validateConceptMap(uniform('javascript'))).toThrow();
    });

    it('accepts a map that is 100% one domain — legal — but warns', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      create.mockResolvedValueOnce(asText(JSON.stringify(uniform('code'))));

      const map = await generateConceptMap('Dynamic programming');

      expect(map.concepts).toHaveLength(20);
      expect(warn.mock.calls.flat().join(' ')).toMatch(/all 20 concepts are "code"/);
      warn.mockRestore();
    });

    it('does not warn on a map with a normal spread', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      create.mockResolvedValueOnce(asText(fixtureText));

      await generateConceptMap('React Hooks');

      expect(warn.mock.calls.flat().join(' ')).not.toMatch(/concepts are/);
      warn.mockRestore();
    });

    it('retries once on an invented domain, then accepts a corrected map', async () => {
      // The acceptance criterion: an unknown value fails Zod and is retried
      // exactly as any other invalid field is — not treated as a special case.
      create.mockResolvedValueOnce(asText(JSON.stringify(uniform('javascript')))).mockResolvedValueOnce(asText(fixtureText));

      const map = await generateConceptMap('React Hooks');

      expect(map.concepts.length).toBeGreaterThanOrEqual(20);
      expect(create).toHaveBeenCalledTimes(2);
    });

    it('domainSplit counts every domain, including the ones with none', () => {
      expect(domainSplit(validateConceptMap(uniform('math')))).toEqual({ code: 0, math: 20, systems: 0, prose: 0 });
    });
  });

  it('validateConceptMap and parseConceptMapResponse work on raw input', () => {
    expect(validateConceptMap(smallMap).concepts).toHaveLength(2);
    expect(parseConceptMapResponse(`\`\`\`json\n${JSON.stringify(smallMap)}\n\`\`\``).concepts).toHaveLength(2);
    expect(() => validateConceptMap({ topic: 'X', concepts: [{ slug: 'a', title: 'A', summary: 'a', prereqs: ['x'], domain: 'prose' }] }))
      .toThrow(GenerationError);
  });
});
