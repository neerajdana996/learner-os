/**
 * A block only where a domain section describes one (T-166 / T-167).
 *
 * Both halves of the same mechanism, found in the first real generation of
 * *HashMap + prefix sums*: the domain fragment did not control behaviour in
 * either direction. Items carried **no** blocks at all — 104 of them, including
 * a `code` batch that had `domains/code.md` appended asking for them — because
 * `blocks` appeared nowhere in the generic output contract or its example.
 * Teaching carried blocks on **everything** — 13 of 13, 12 of kind `code`,
 * including six `prose` concepts that load no fragment at all — because
 * `teachBlock` is a field of the main contract and nothing checked the rule
 * forbidding it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { teachingInput } from './fixtures.js';

const create = vi.fn();
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create } };
  },
}));

const { generateItemsBatch } = await import('../items.js');
const { generateTeaching } = await import('../teaching.js');
const { collectWarnings } = await import('../severity.js');

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures');
const read = (name: string) => JSON.parse(readFileSync(join(fixtures, name), 'utf8'));
const asText = (value: unknown) => ({
  choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }],
});

const codeItems = read('items.binary-search-bound.json');
const asBatch = (slug: string, items: unknown[]) => ({ concepts: [{ slug, items }] });

/** The teachBlock that ended run 5, verbatim from the model. Everything about
 *  it is valid except `edges[2].label`: 25 characters against a limit of 24. */
const RUN5_BLOCK = {
  kind: 'diagram',
  nodes: [
    { id: 'p3', label: 'P[3]: days 1–3 = 6' },
    { id: 'range', label: 'days 4–9 total 1' },
    { id: 'p9', label: 'P[9]: days 1–9 = 7' },
    { id: 'result', label: 'P[9] − P[3] = 7 − 6 = 1' },
  ],
  edges: [
    { from: 'p3', to: 'p9', label: 'P[9] includes days 1–3' },
    { from: 'range', to: 'p9', label: 'and days 4–9' },
    { from: 'p9', to: 'result', label: 'subtract: days 1–3 cancel' },
    { from: 'p3', to: 'result', label: 'remove' },
  ],
  alt: 'P[3] contains days 1 through 3. P[9] contains days 1 through 9. Subtracting P[3] from P[9] leaves days 4 through 9.',
};

const batchInput = (domain?: string) => ({
  topic: 'Binary search',
  level: 'working',
  spine: 'a search over a sorted array',
  domain,
  concepts: [
    { slug: 'bound', title: 'Exclusive upper bound', summary: 'hi is one past the end.', misconceptions: ['hi is the last index'] },
  ],
  neighbours: '',
  asked: '',
});

beforeEach(() => create.mockReset());

describe('items: a block needs a domain section', () => {
  it('keeps blocks for a code batch, which is the batch that asked for them', async () => {
    create.mockResolvedValue(asText(asBatch('bound', codeItems.items)));

    const { result, warnings } = await collectWarnings(() => generateItemsBatch(batchInput('code')));

    const withBlocks = (result.bySlug.get('bound') ?? []).filter((i) => i.payload.blocks?.length);
    expect(withBlocks.length).toBeGreaterThan(0);
    expect(warnings).toHaveLength(0);
  });

  it('drops blocks for a prose batch and says which concept they came from', async () => {
    create.mockResolvedValue(asText(asBatch('bound', codeItems.items)));

    const { result, warnings } = await collectWarnings(() => generateItemsBatch(batchInput('prose')));

    // Dropped, not rejected: a block nobody specified is decoration on one
    // question, and rejecting would end the whole topic over it (T-164).
    for (const item of result.bySlug.get('bound') ?? []) {
      expect(item.payload.blocks ?? []).toHaveLength(0);
    }
    expect(warnings).toContainEqual(
      expect.objectContaining({
        reason: 'block_without_domain',
        prompt: 'items',
        message: expect.stringContaining('bound'),
      }),
    );
  });

  it('costs no extra model call — the block is dropped, never re-requested', async () => {
    create.mockResolvedValue(asText(asBatch('bound', codeItems.items)));

    await collectWarnings(() => generateItemsBatch(batchInput('prose')));

    // The retry hook deliberately does not run this check: six prose concepts
    // in a sixteen-concept topic would each buy a second call to be told the
    // same thing.
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('teaching: a teachBlock needs a domain section', () => {
  const teaching = read('teaching.usestate.json');

  it('keeps the block for a code concept', async () => {
    create.mockResolvedValue(asText(teaching));

    const { result, warnings } = await collectWarnings(() =>
      generateTeaching(teachingInput({ domain: 'code' })),
    );

    expect(result.teachBlock).not.toBeNull();
    expect(warnings).toHaveLength(0);
  });

  it('drops the block for a prose concept, which is what the prompt already said', async () => {
    create.mockResolvedValue(asText(teaching));

    const { result, warnings } = await collectWarnings(() =>
      generateTeaching(teachingInput({ domain: 'prose' })),
    );

    expect(result.teachBlock).toBeNull();
    // Everything else the lesson is made of survives.
    expect(result.explanationShort.length).toBeGreaterThan(0);
    expect(result.corrections.length).toBeGreaterThanOrEqual(2);
    expect(warnings).toContainEqual(
      expect.objectContaining({ reason: 'block_without_domain', prompt: 'teaching' }),
    );
  });

  it('drops a malformed block and keeps the lesson — the failure that ended run 5', async () => {
    create.mockResolvedValue(asText({ ...teaching, teachBlock: RUN5_BLOCK }));

    // `systems` authorises a diagram, so the domain check is not what drops it.
    const { result, warnings } = await collectWarnings(() =>
      generateTeaching(teachingInput({ domain: 'systems' })),
    );

    expect(result.teachBlock).toBeNull();
    expect(result.explanationShort.length).toBeGreaterThan(0);
    expect(result.corrections.length).toBeGreaterThanOrEqual(2);
    expect(warnings).toContainEqual(
      expect.objectContaining({ reason: 'block_malformed', prompt: 'teaching', message: expect.stringContaining('edges.2.label') }),
    );
    // Dropped once on the way out, never re-requested.
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('drops it for a concept with no domain at all', async () => {
    create.mockResolvedValue(asText(teaching));

    const { result } = await collectWarnings(() => generateTeaching(teachingInput({})));

    expect(result.teachBlock).toBeNull();
  });
});
