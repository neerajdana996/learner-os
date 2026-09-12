import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aFraming } from './fixtures.js';

// Mock at the SDK boundary (openai.chat.completions.create) so the real
// complete() → stripFences → JSON.parse → Zod → graph-validation pipeline runs,
// and "called twice" assertions count actual model calls.
const create = vi.fn();
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create } };
  },
}));

const { generateConceptMap, validateConceptMap, parseConceptMapResponse, domainSplit, ConceptMapSchema, GenerationError, EXPECTED_MIN_CONCEPTS } =
  await import('../conceptMap.js');

const fixtureText = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/conceptMap.react-hooks.json'),
  'utf8',
);
const fixture = JSON.parse(fixtureText);

const asText = (text: string, finishReason = 'stop') => ({
  choices: [{ message: { content: text }, finish_reason: finishReason }],
});


/** The capability ids the default framing promises. A map is only valid
 *  against a framing if every one of them is served (`capability_unserved`),
 *  so fixtures that reach the outer checks have to cover all three. */
const CAPS = aFraming().capabilities.map((capability) => capability.id);

/** A structurally complete concept; individual tests break one field on purpose. */
const aConcept = (over: Record<string, unknown>) => ({
  title: 'A', summary: 'a', prereqs: [], serves: [CAPS[0]],
  misconceptions: ['the obvious reading'], hardBecause: 'not-hard' as const,
  domain: 'prose' as const, ...over,
});

/** Valid in every other respect — three roots, all capabilities served — and
 *  small enough to sit under MIN_CONCEPTS, so the count is the only thing left
 *  to reject it. Anything else here fails earlier and tests a different rule. */
const smallMap = {
  topic: 'React Hooks',
  crux: ['a', 'b'],
  concepts: [
    aConcept({ slug: 'a', misconceptions: ['one', 'two'] }),
    aConcept({ slug: 'b', title: 'B', serves: [CAPS[1]], domain: 'code' as const, misconceptions: ['one', 'two'] }),
    aConcept({ slug: 'c', title: 'C', serves: [CAPS[2]] }),
  ],
};

beforeEach(() => create.mockReset());

describe('concept map generation', () => {
  it('fixture round-trips through ConceptMapSchema.parse', () => {
    expect(() => ConceptMapSchema.parse(fixture)).not.toThrow();
  });

  it('parses the fixture and returns a full-sized map in one model call', async () => {
    create.mockResolvedValueOnce(asText(fixtureText));
    const result = await generateConceptMap(aFraming({ topic: 'React Hooks' }));
    expect(result.concepts.length).toBeGreaterThanOrEqual(EXPECTED_MIN_CONCEPTS);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('parses a response wrapped in ```json fences', async () => {
    create.mockResolvedValueOnce(asText(`Here you go:\n\`\`\`json\n${fixtureText}\n\`\`\``));
    const result = await generateConceptMap(aFraming({ topic: 'React Hooks' }));
    expect(result.concepts.length).toBeGreaterThanOrEqual(EXPECTED_MIN_CONCEPTS);
  });

  it('rejects a prereq slug that does not exist', async () => {
    // Domain failures retry once (T-FIX-013), so both attempts see the bad map.
    create.mockResolvedValue(
      asText(JSON.stringify({ topic: 'X', crux: ['state', 'other'], concepts: [aConcept({ slug: 'state', prereqs: ['nope'], misconceptions: ['a', 'b'] }), aConcept({ slug: 'other', misconceptions: ['a', 'b'] })] })),
    );
    await expect(generateConceptMap(aFraming({ topic: 'X' }))).rejects.toMatchObject({
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
          crux: ['a', 'b'],
          concepts: [
            aConcept({ slug: 'a', prereqs: ['b'], misconceptions: ['x', 'y'] }),
            aConcept({ slug: 'b', prereqs: ['a'], misconceptions: ['x', 'y'] }),
          ],
        }),
      ),
    );
    await expect(generateConceptMap(aFraming({ topic: 'X' }))).rejects.toMatchObject({ name: 'GenerationError', reason: 'cycle' });
  });

  it('rejects duplicate slugs before they hit the concepts unique index', async () => {
    // Domain failures retry once (T-FIX-013), so both attempts see the bad map.
    create.mockResolvedValue(
      asText(
        JSON.stringify({
          topic: 'X',
          crux: ['a', 'b'],
          concepts: [
            aConcept({ slug: 'dup', misconceptions: ['x', 'y'] }),
            aConcept({ slug: 'dup', title: 'B', misconceptions: ['x', 'y'] }),
          ],
        }),
      ),
    );
    await expect(generateConceptMap(aFraming({ topic: 'X' }))).rejects.toMatchObject({
      name: 'GenerationError',
      reason: 'duplicate_slug',
    });
  });

  it('rejects a map too small to teach', async () => {
    create.mockResolvedValueOnce(asText(JSON.stringify(smallMap)));
    await expect(generateConceptMap(aFraming({ topic: 'X' }))).rejects.toMatchObject({
      name: 'GenerationError',
      reason: 'too_few_concepts',
    });
  });

  it('retries once when the first response is not JSON, then resolves', async () => {
    create.mockResolvedValueOnce(asText('sorry, here is your map!')).mockResolvedValueOnce(asText(fixtureText));
    const result = await generateConceptMap(aFraming({ topic: 'React Hooks' }));
    expect(result.concepts.length).toBeGreaterThanOrEqual(EXPECTED_MIN_CONCEPTS);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('rejects with GenerationError when both attempts fail, without a third call', async () => {
    create.mockResolvedValue(asText('not json'));
    await expect(generateConceptMap(aFraming({ topic: 'X' }))).rejects.toMatchObject({
      name: 'GenerationError',
      reason: 'invalid_json',
    });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('does not retry a truncated response', async () => {
    create.mockResolvedValue(asText(`{"topic":"X","concepts":[`, 'length'));
    await expect(generateConceptMap(aFraming({ topic: 'X' }))).rejects.toMatchObject({
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
      crux: ['c0', 'c1'],
      concepts: Array.from({ length: 20 }, (_, i) => ({
        slug: `c${i}`,
        title: `C${i}`,
        summary: 's',
        prereqs: [],
        serves: [CAPS[i % CAPS.length]],
        misconceptions: ['one', 'two'],
        hardBecause: 'not-hard' as const,
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

      const map = await generateConceptMap(aFraming({ topic: 'Dynamic programming' }));

      expect(map.concepts).toHaveLength(20);
      expect(warn.mock.calls.flat().join(' ')).toMatch(/all 20 concepts are "code"/);
      warn.mockRestore();
    });

    it('does not warn on a map with a normal spread', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      create.mockResolvedValueOnce(asText(fixtureText));

      await generateConceptMap(aFraming({ topic: 'React Hooks' }));

      expect(warn.mock.calls.flat().join(' ')).not.toMatch(/concepts are/);
      warn.mockRestore();
    });

    it('retries once on an invented domain, then accepts a corrected map', async () => {
      // The acceptance criterion: an unknown value fails Zod and is retried
      // exactly as any other invalid field is — not treated as a special case.
      create.mockResolvedValueOnce(asText(JSON.stringify(uniform('javascript')))).mockResolvedValueOnce(asText(fixtureText));

      const map = await generateConceptMap(aFraming({ topic: 'React Hooks' }));

      expect(map.concepts.length).toBeGreaterThanOrEqual(EXPECTED_MIN_CONCEPTS);
      expect(create).toHaveBeenCalledTimes(2);
    });

    it('domainSplit counts every domain, including the ones with none', () => {
      expect(domainSplit(validateConceptMap(uniform('math')))).toEqual({ code: 0, math: 20, systems: 0, prose: 0 });
    });
  });

  it('validateConceptMap and parseConceptMapResponse work on raw input', () => {
    expect(validateConceptMap(smallMap).concepts).toHaveLength(3);
    expect(parseConceptMapResponse(`\`\`\`json\n${JSON.stringify(smallMap)}\n\`\`\``).concepts).toHaveLength(3);
    expect(() => validateConceptMap({ topic: 'X', crux: ['a', 'b'], concepts: [aConcept({ slug: 'a', prereqs: ['x'], misconceptions: ['m', 'n'] }), aConcept({ slug: 'b', misconceptions: ['m', 'n'] })] }))
      .toThrow(GenerationError);
  });
});
