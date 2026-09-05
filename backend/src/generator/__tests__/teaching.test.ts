import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock at the SDK boundary so the real complete() → stripFences → JSON.parse →
// Zod → cross-field validation pipeline runs, and so the rendered prompt can be
// inspected (T-FIX-006: no test used to assert what was actually sent).
const create = vi.fn();
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create } };
  },
}));

const { generateTeaching, validateTeaching, parseTeachingResponse } = await import('../teaching.js');
const { GenerationError } = await import('../errors.js');

const fixtureText = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/teaching.usestate.json'),
  'utf8',
);
const fixture = JSON.parse(fixtureText);

const asText = (text: string, finishReason = 'stop') => ({
  choices: [{ message: { content: text }, finish_reason: finishReason }],
});

const input = {
  topic: 'React Hooks',
  concept: 'useState',
  summary: 'Adds state to a function component',
  teachMode: 'try_first' as const,
};

/** Smallest structurally valid payload; individual tests break one field. */
const valid = () => ({
  tryFirstPrompt: 'What do you think happens?',
  explanationShort: 'Short answer here.',
  explanationLong: 'A considerably longer answer that genuinely expands on the short one.',
  corrections: [
    { wrong: 'a common mistake', why: 'why it is wrong' },
    { wrong: 'another mistake', why: 'why that is wrong too' },
  ],
});

beforeEach(() => create.mockReset());

describe('teaching content generation', () => {
  it('parses the fixture in one model call', async () => {
    create.mockResolvedValueOnce(asText(fixtureText));
    const result = await generateTeaching(input);

    expect(result.explanationShort).toBe(fixture.explanationShort);
    expect(result.corrections).toHaveLength(3);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('fixture has both explanations and at least two corrections', () => {
    const result = validateTeaching(fixture);
    expect(result.explanationShort.length).toBeGreaterThan(0);
    expect(result.explanationLong.length).toBeGreaterThan(0);
    expect(result.corrections.length).toBeGreaterThanOrEqual(2);
  });

  it('sends the topic, concept, summary and teach mode to the model', async () => {
    create.mockResolvedValueOnce(asText(fixtureText));
    await generateTeaching(input);

    const sent = JSON.stringify(create.mock.calls[0]?.[0]?.messages);
    // The items generator only ever received a bare concept title, which is
    // how "Dependency Array" reaches the model with no hint that it means
    // React (T-FIX-006). This asserts that mistake isn't repeated here.
    expect(sent).toContain('React Hooks');
    expect(sent).toContain('useState');
    expect(sent).toContain('Adds state to a function component');
    expect(sent).toContain('try_first');
  });

  it('tells the model when a concept is example_first', async () => {
    create.mockResolvedValueOnce(asText(fixtureText));
    await generateTeaching({ ...input, teachMode: 'example_first' });

    const sent = JSON.stringify(create.mock.calls[0]?.[0]?.messages);
    expect(sent).toContain('example_first');
  });

  it('strips markdown fences', () => {
    expect(() => parseTeachingResponse(`\`\`\`json\n${fixtureText}\n\`\`\``)).not.toThrow();
  });

  it('rejects a correction missing its why', () => {
    const bad = valid();
    bad.corrections = [{ wrong: 'a mistake' } as never, { wrong: 'b', why: 'because' }];
    expect(() => validateTeaching(bad)).toThrow(GenerationError);
  });

  it('rejects fewer than two corrections', () => {
    const bad = { ...valid(), corrections: [{ wrong: 'only one', why: 'because' }] };
    expect(() => validateTeaching(bad)).toThrow(/corrections/);
  });

  it('rejects more than four corrections', () => {
    const bad = {
      ...valid(),
      corrections: Array.from({ length: 5 }, (_, i) => ({ wrong: `w${i}`, why: `y${i}` })),
    };
    expect(() => validateTeaching(bad)).toThrow(/corrections/);
  });

  it('rejects a long explanation that is not longer than the short one', () => {
    const bad = { ...valid(), explanationLong: 'Short answer here!' };
    // A reworded copy of the same length means "read more" shows the learner
    // nothing new, so it is rejected rather than shipped.
    expect(() => validateTeaching(bad)).toThrow(/longer/);
  });

  it('rejects an empty explanation', () => {
    expect(() => validateTeaching({ ...valid(), explanationShort: '   ' })).toThrow(GenerationError);
  });

  it('rejects a missing tryFirstPrompt', () => {
    const bad: Record<string, unknown> = valid();
    delete bad.tryFirstPrompt;
    expect(() => validateTeaching(bad)).toThrow(GenerationError);
  });

  it('retries once on malformed output, then resolves', async () => {
    create.mockResolvedValueOnce(asText('here you go!')).mockResolvedValueOnce(asText(fixtureText));
    await expect(generateTeaching(input)).resolves.toMatchObject({ corrections: expect.any(Array) });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('fails when both attempts are malformed', async () => {
    create.mockResolvedValue(asText('still not json'));
    await expect(generateTeaching(input)).rejects.toThrow(GenerationError);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('does not retry a truncated response', async () => {
    create.mockResolvedValue(asText('{"tryFirstPrompt":"', 'length'));
    await expect(generateTeaching(input)).rejects.toThrow(GenerationError);
    // Re-sending an identical request truncates at the same point, so a retry
    // would only burn a second call.
    expect(create).toHaveBeenCalledTimes(1);
  });
});
