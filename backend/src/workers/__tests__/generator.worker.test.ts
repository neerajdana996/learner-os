import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

const generateConceptMap = vi.fn();
const generateFraming = vi.fn();
const generateItemsBatch = vi.fn();
const generateTeaching = vi.fn();
vi.mock('../../generator/conceptMap.js', () => ({ generateConceptMap: (...a: unknown[]) => generateConceptMap(...a) }));
vi.mock('../../generator/framing.js', () => ({
  generateFraming: (...a: unknown[]) => generateFraming(...a),
  formatSpine: (spine: { name: string }) => spine.name,
}));
// Spread the real module rather than hand-listing what to re-export. The
// worker reads `SPLITTABLE_BATCH_REASONS` to decide whether a failed batch is
// worth splitting, and `itemBlocks.ts` reads `MAX_RICH_ITEMS` and
// `itemVariants` at module load — a mock that omits any of them fails at
// import with an error naming a file nobody changed.
vi.mock('../../generator/items.js', async () => ({
  ...(await vi.importActual<typeof import('../../generator/items.js')>('../../generator/items.js')),
  generateItemsBatch: (...a: unknown[]) => generateItemsBatch(...a),
}));
vi.mock('../../generator/teaching.js', () => ({ generateTeaching: (...a: unknown[]) => generateTeaching(...a) }));
// T-FIX-013. The enrichment pass (T-166) is a real model call. Unmocked, every
// generation test here ran it: the fetch guard in vitest.setup.ts refused the
// request, the OpenAI SDK retried that refusal twice with backoff, and
// `enrichConceptItems` swallowed the error as `enrichment_failed` — seconds of
// dead time per concept, enough to push tests past their timeout. A
// pass-through keeps these tests about the worker.
vi.mock('../../generator/itemBlocks.js', async () => ({
  ...(await vi.importActual<typeof import('../../generator/itemBlocks.js')>('../../generator/itemBlocks.js')),
  enrichConceptItems: async (input: { items: unknown[] }) => ({ items: input.items }),
}));

const fakeFraming = () => ({
  topic: 'React Hooks',
  level: 'working' as const,
  capabilities: [{ id: 'cap', statement: 'Do the thing.', evidence: 'Does the thing.' }],
  centralMisconception: 'The obvious reading is the right one.',
  spine: { name: 'a search box', description: 'one component', whyItFits: 'serves cap' },
  assumedKnowledge: ['has written a component', 'knows what props are'],
  outOfScope: ['class components', 'state libraries'],
});

const fakeTeaching = (concept: string) => ({
  tryFirstPrompt: `What do you think ${concept} does?`,
  explanationShort: `${concept} in brief.`,
  explanationLong: `${concept} at greater length, with more detail than the short form.`,
  corrections: [
    { wrong: `${concept} misconception`, why: 'because that is not how it works' },
    { wrong: `another ${concept} misconception`, why: 'nor that' },
  ],
});

const { processGenerationJob } = await import('../generator.worker.js');
const { GenerationError } = await import('../../generator/errors.js');
const { pickHeldOut, seededRng } = await import('../../lib/heldOut.js');
const { db } = await import('../../db/client.js');
const { concepts, conceptPrereqs, items, topics } = await import('../../db/schema.js');
const { seedUser, truncateAll } = await import('../../test/db.js');

/** n concepts in teaching order, each depending on the one before it. */
const DOMAINS = ['code', 'prose', 'systems', 'math'] as const;
// Alternated so both teach modes appear: `teachModeFor` sends
// `counterintuitive` to try_first and `no-prior-hook` to example_first.
const HARDNESS = ['counterintuitive', 'no-prior-hook'] as const;

function fakeMap(n: number, crux: string[] = []) {
  return {
    topic: 'React Hooks',
    crux,
    concepts: Array.from({ length: n }, (_, i) => ({
      slug: `c${i + 1}`,
      title: `Concept ${i + 1}`,
      summary: `summary ${i + 1}`,
      prereqs: i === 0 ? [] : [`c${i}`],
      serves: ['cap'],
      misconceptions: [`c${i + 1} is the same as c${i}`],
      hardBecause: HARDNESS[i % HARDNESS.length] as (typeof HARDNESS)[number],
      // Cycled rather than fixed, so a worker that dropped the field or wrote
      // the same one for every row would fail the assertion below (T-082).
      domain: DOMAINS[i % DOMAINS.length] as (typeof DOMAINS)[number],
    })),
  };
}

/** One batch: the same two items for every slug it was asked about. */
const fakeBatch = (input: { topic: string; concepts: { slug: string }[] }) => ({
  topic: input.topic,
  bySlug: new Map(
    input.concepts.map(({ slug }) => [
      slug,
      [
        { payload: { type: 'recall' as const, prompt: `${slug} Q1`, answer: 'A' }, isTransfer: false },
        {
          payload: {
            type: 'recognition' as const,
            prompt: `${slug} Q2`,
            options: ['a', 'b', 'c', 'd'],
            answerIndex: 0,
            distractorSource: 'the adjacent idea',
          },
          isTransfer: true,
        },
      ],
    ]),
  ),
});

async function seedTopic(values: { language?: string } = {}) {
  const user = await seedUser();
  const [topic] = await db
    .insert(topics)
    .values({ userId: user.id, title: 'React Hooks', ...values })
    .returning({ id: topics.id });
  if (!topic) throw new Error('topic insert returned no row');
  return topic;
}

beforeEach(async () => {
  generateConceptMap.mockReset();
  generateFraming.mockReset();
  generateItemsBatch.mockReset();
  generateTeaching.mockReset();
  // Defaults so tests that don't care about scoping or teaching content don't
  // have to set them up; a test asserting on either overrides it. Framing is
  // phase 0 (T-161) — every later stage reads its spine, so a test without one
  // fails inside the worker rather than on the thing it is about.
  generateFraming.mockResolvedValue(fakeFraming());
  generateTeaching.mockImplementation(async ({ concept }: { concept: string }) => fakeTeaching(concept));
  await truncateAll();
});

describe('pickHeldOut', () => {
  const ordered = Array.from({ length: 20 }, (_, i) => ({ slug: `c${i + 1}`, order: i + 1 }));

  it('is deterministic for a given seed', () => {
    const a = [...pickHeldOut(ordered, 0.1, 3, seededRng(42))].sort();
    const b = [...pickHeldOut(ordered, 0.1, 3, seededRng(42))].sort();
    expect(a).toEqual(b);
  });

  it('never picks a concept at or below minOrder', () => {
    // Sweep seeds so this can't pass by luck on one draw.
    for (let seed = 0; seed < 50; seed++) {
      for (const slug of pickHeldOut(ordered, 0.1, 3, seededRng(seed))) {
        const order = ordered.find((c) => c.slug === slug)?.order ?? 0;
        expect(order).toBeGreaterThan(3);
      }
    }
  });

  it('picks max(HELD_OUT_MIN, round(n * ratio)), capped at the eligible pool and the max share', () => {
    // 20 concepts: round(20 * 0.1) = 2, but HELD_OUT_MIN (3, T-123) wins.
    expect(pickHeldOut(ordered, 0.1, 3, seededRng(1)).size).toBe(3);
    // 5 concepts, minOrder 3: only orders 4-5 are eligible (pool of 2), and
    // HELD_OUT_MAX_SHARE caps the want at floor(5 * 0.25) = 1 before the pool
    // size even comes into it — HELD_OUT_MIN would ask for 3, which is more
    // than either cap allows.
    const five = Array.from({ length: 5 }, (_, i) => ({ slug: `c${i + 1}`, order: i + 1 }));
    expect(pickHeldOut(five, 0.1, 3, seededRng(1)).size).toBe(1);
    // Everything is below minOrder, so nothing is eligible.
    const three = Array.from({ length: 3 }, (_, i) => ({ slug: `c${i + 1}`, order: i + 1 }));
    expect(pickHeldOut(three, 0.1, 3, seededRng(1)).size).toBe(0);
  });
});

describe('processGenerationJob', () => {
  it('persists the map, prereqs and items, and activates the topic', async () => {
    const topic = await seedTopic();
    generateFraming.mockResolvedValue(fakeFraming());
    generateConceptMap.mockResolvedValueOnce(fakeMap(20));
    generateItemsBatch.mockImplementation(async (i: Parameters<typeof fakeBatch>[0]) => fakeBatch(i));

    await processGenerationJob({ topicId: topic.id }, seededRng(42));

    const rows = await db.select().from(concepts).where(eq(concepts.topicId, topic.id));
    expect(rows).toHaveLength(20);

    // exactly max(HELD_OUT_MIN, round(20 * 0.1)) held out — HELD_OUT_MIN (3,
    // T-123) wins over the ratio's round(2) here — none in the first 3 by
    // order.
    const held = rows.filter((r) => r.heldOut);
    expect(held).toHaveLength(3);
    expect(held.every((r) => r.order > 3)).toBe(true);

    // teach_mode set on every concept, and both values show up in 20
    expect(rows.every((r) => r.teachMode !== null)).toBe(true);
    expect(new Set(rows.map((r) => r.teachMode))).toEqual(new Set(['try_first', 'example_first']));

    // 19 edges for a 20-concept chain
    const prereqRows = await db.select().from(conceptPrereqs);
    expect(prereqRows).toHaveLength(19);

    /**
     * **Every concept gets items, held-out included (T-120).**
     *
     * This assertion previously required held-out concepts to have *zero*
     * items, which encoded the defect as intended behaviour: `assembleTest`
     * throws `Missing eligible held-out question` without one, so no topic
     * could produce a Day-30 test, and the control arm — the entire basis of
     * the pilot's claim — could never be measured. The suite was green because
     * `tests.fixtures.ts` seeds held-out items directly.
     *
     * It is corrected here, not deleted: the rule it asserted was wrong.
     */
    const itemRows = await db.select().from(items);
    const heldIds = new Set(held.map((r) => r.id));
    expect(itemRows.filter((i) => heldIds.has(i.conceptId)).length).toBeGreaterThan(0);
    expect(itemRows).toHaveLength(20 * 2);
    // 20 concepts cycling four domains is five per domain, and a batch holds
    // at most four of one domain — so four and one, twice over, per domain.
    expect(generateItemsBatch).toHaveBeenCalledTimes(8);

    const [after] = await db.select().from(topics).where(eq(topics.id, topic.id));
    expect(after?.status).toBe('active');
    expect(after?.error).toBeNull();
  });

  // T-053 — teaching content is what T-016's GET /session returns and T-021
  // renders, so it has to survive the same transaction as the map.
  it('persists teaching content for every taught concept', async () => {
    const topic = await seedTopic();
    generateFraming.mockResolvedValue(fakeFraming());
    generateConceptMap.mockResolvedValueOnce(fakeMap(20));
    generateItemsBatch.mockImplementation(async (i: Parameters<typeof fakeBatch>[0]) => fakeBatch(i));

    await processGenerationJob({ topicId: topic.id }, seededRng(42));

    const rows = await db.select().from(concepts).where(eq(concepts.topicId, topic.id));
    const taught = rows.filter((r) => !r.heldOut);

    // 20 concepts − HELD_OUT_MIN (3, T-123) held out.
    expect(taught).toHaveLength(17);
    for (const row of taught) {
      expect(row.tryFirstPrompt).toBeTruthy();
      expect(row.explanationShort).toBeTruthy();
      expect(row.explanationLong).toBeTruthy();
      expect((row.corrections as unknown[]).length).toBeGreaterThanOrEqual(2);
      // "read more" must reveal something new, not the same text again.
      expect((row.explanationLong ?? '').length).toBeGreaterThan((row.explanationShort ?? '').length);
    }
  });

  it('generates no teaching content for held-out concepts', async () => {
    const topic = await seedTopic();
    generateFraming.mockResolvedValue(fakeFraming());
    generateConceptMap.mockResolvedValueOnce(fakeMap(20));
    generateItemsBatch.mockImplementation(async (i: Parameters<typeof fakeBatch>[0]) => fakeBatch(i));

    await processGenerationJob({ topicId: topic.id }, seededRng(42));

    const rows = await db.select().from(concepts).where(eq(concepts.topicId, topic.id));
    const held = rows.filter((r) => r.heldOut);

    expect(held.length).toBeGreaterThan(0);
    for (const row of held) {
      expect(row.tryFirstPrompt).toBeNull();
      expect(row.explanationShort).toBeNull();
      expect(row.explanationLong).toBeNull();
      expect(row.corrections).toEqual([]);
    }
    // Never even asked for — a held-out concept must cost nothing to generate
    // and, more importantly, must not exist as teachable text anywhere.
    // 20 concepts − HELD_OUT_MIN (3, T-123) held out.
    expect(generateTeaching).toHaveBeenCalledTimes(17);
  });

  it('conditions the teaching prompt on the concept’s teach mode', async () => {
    const topic = await seedTopic();
    generateFraming.mockResolvedValue(fakeFraming());
    generateConceptMap.mockResolvedValueOnce(fakeMap(20));
    generateItemsBatch.mockImplementation(async (i: Parameters<typeof fakeBatch>[0]) => fakeBatch(i));

    await processGenerationJob({ topicId: topic.id }, seededRng(42));

    const rows = await db.select().from(concepts).where(eq(concepts.topicId, topic.id));
    const modeBySlug = new Map(rows.map((r) => [r.slug, r.teachMode]));

    // The mode stored on the row must be the mode the generator was told, or
    // an example_first concept gets an explanation written with no worked
    // example and plan.md §3.4's A/B compares two identical arms.
    for (const call of generateTeaching.mock.calls) {
      const arg = call[0] as { concept: string; teachMode: string; topic: string; summary: string };
      const row = rows.find((r) => r.title === arg.concept);
      expect(arg.teachMode).toBe(modeBySlug.get(row?.slug ?? ''));
      expect(arg.topic).toBe('React Hooks');
    }
  });

  // T-082 — the map decides the domain and the worker is the only thing that
  // can carry it to the row. T-079 left the column nullable, so a worker that
  // dropped this would look fine and silently disable every format decision.
  it('persists each concept’s domain from the map', async () => {
    const topic = await seedTopic();
    generateFraming.mockResolvedValue(fakeFraming());
    generateConceptMap.mockResolvedValueOnce(fakeMap(20));
    generateItemsBatch.mockImplementation(async (i: Parameters<typeof fakeBatch>[0]) => fakeBatch(i));

    await processGenerationJob({ topicId: topic.id }, seededRng(42));

    const rows = await db.select().from(concepts).where(eq(concepts.topicId, topic.id));
    const bySlug = new Map(rows.map((r) => [r.slug, r.domain]));
    for (const concept of fakeMap(20).concepts) {
      expect(bySlug.get(concept.slug), concept.slug).toBe(concept.domain);
    }
    // And not the same value for all of them, which a hardcoded default would
    // also satisfy.
    expect(new Set(rows.map((r) => r.domain)).size).toBeGreaterThan(1);
  });

  // T-091 — the topic's language, read from the row rather than decided forty
  // times over. Both generators get it, because a Python explanation followed
  // by JavaScript questions is the same bug seen twice.
  it('passes the topic language to both generators, and undefined when there is none', async () => {
    const withLanguage = await seedTopic({ language: 'Python' });
    generateFraming.mockResolvedValue(fakeFraming());
    generateConceptMap.mockResolvedValueOnce(fakeMap(20));
    generateItemsBatch.mockImplementation(async (i: Parameters<typeof fakeBatch>[0]) => fakeBatch(i));

    await processGenerationJob({ topicId: withLanguage.id }, seededRng(42));

    expect(generateItemsBatch.mock.calls.length).toBeGreaterThan(0);
    for (const call of generateItemsBatch.mock.calls) {
      expect((call[0] as { language?: string }).language).toBe('Python');
    }
    for (const call of generateTeaching.mock.calls) {
      expect((call[0] as { language?: string }).language).toBe('Python');
    }

    generateConceptMap.mockReset();
    generateFraming.mockReset();
    generateItemsBatch.mockReset();
    generateTeaching.mockReset();
    generateTeaching.mockImplementation(async ({ concept }: { concept: string }) => fakeTeaching(concept));

    const bare = await seedTopic();
    generateFraming.mockResolvedValue(fakeFraming());
    generateConceptMap.mockResolvedValueOnce(fakeMap(20));
    generateItemsBatch.mockImplementation(async (i: Parameters<typeof fakeBatch>[0]) => fakeBatch(i));

    await processGenerationJob({ topicId: bare.id }, seededRng(42));

    // Undefined, not '': the generator turns an absent language into an omitted
    // prompt line, and an empty string would be indistinguishable here.
    for (const call of generateItemsBatch.mock.calls) {
      expect((call[0] as { language?: string }).language).toBeUndefined();
    }
    for (const call of generateTeaching.mock.calls) {
      expect((call[0] as { language?: string }).language).toBeUndefined();
    }
  });

  // T-064 — the wait screen's counter reads `counts.concepts`, which is 0 for
  // the whole run because persistence is one transaction at the end. Progress
  // is reported out of band instead, so the screen has something true to show.
  it('reports progress as it works, ending at completed = total', async () => {
    const topic = await seedTopic();
    generateFraming.mockResolvedValue(fakeFraming());
    generateConceptMap.mockResolvedValueOnce(fakeMap(20));
    generateItemsBatch.mockImplementation(async (i: Parameters<typeof fakeBatch>[0]) => fakeBatch(i));

    const progress: { stage: string; completed: number; total: number; concept?: string }[] = [];
    await processGenerationJob({ topicId: topic.id }, seededRng(42), (p) => {
      progress.push(p);
    });

    expect(progress[0]).toMatchObject({ stage: 'map', completed: 0 });

    // All 20 concepts, one report each, monotonic. Held-out concepts are in the
    // count because they now get items (T-120) — the bar tracks work actually
    // being done, and reporting 18/18 while doing twenty calls' worth of waiting
    // is a progress bar that lies about the wait.
    const content = progress.filter((p) => p.stage === 'content');
    expect(content.at(-1)).toMatchObject({ completed: 20, total: 20 });
    expect(content.map((p) => p.completed)).toEqual([0, ...Array.from({ length: 20 }, (_, i) => i + 1)]);
    expect(content.at(-1)?.concept).toBe('Concept 20');

    expect(progress.at(-1)).toMatchObject({ stage: 'saving', completed: 20, total: 20 });
  });

  it('does not require a progress reporter', async () => {
    const topic = await seedTopic();
    generateConceptMap.mockResolvedValueOnce(fakeMap(6));
    generateItemsBatch.mockImplementation(async (i: Parameters<typeof fakeBatch>[0]) => fakeBatch(i));

    // The Sprint walks and most unit tests call this directly; needing a queue
    // to run a generation would be a poor trade for a progress bar.
    await expect(processGenerationJob({ topicId: topic.id }, seededRng(42))).resolves.toBeUndefined();
  });

  it('marks the topic failed and persists nothing when generation throws', async () => {
    const topic = await seedTopic();
    generateConceptMap.mockRejectedValueOnce(new Error('unknown_prereq: c9 references missing prereq nope'));

    await expect(processGenerationJob({ topicId: topic.id }, seededRng(1))).rejects.toThrow(/unknown_prereq/);

    expect(await db.select().from(concepts).where(eq(concepts.topicId, topic.id))).toHaveLength(0);
    const [after] = await db.select().from(topics).where(eq(topics.id, topic.id));
    expect(after?.status).toBe('failed');
    expect(after?.error).toMatch(/unknown_prereq/);
  });

  it('rolls the whole map back when item generation fails partway through', async () => {
    const topic = await seedTopic();
    generateFraming.mockResolvedValue(fakeFraming());
    generateConceptMap.mockResolvedValueOnce(fakeMap(20));
    generateItemsBatch
      .mockImplementationOnce(async (i: Parameters<typeof fakeBatch>[0]) => fakeBatch(i))
      .mockRejectedValueOnce(new Error('truncated: response hit max_tokens'));

    await expect(processGenerationJob({ topicId: topic.id }, seededRng(7))).rejects.toThrow(/truncated/);

    // The transaction is opened only after every model call returns, so a
    // mid-generation failure leaves no partial map behind.
    expect(await db.select().from(concepts).where(eq(concepts.topicId, topic.id))).toHaveLength(0);
    expect(await db.select().from(items)).toHaveLength(0);
    const [after] = await db.select().from(topics).where(eq(topics.id, topic.id));
    expect(after?.status).toBe('failed');
  });
  /**
   * T-164. Two real generations died this way before the fallback existed: one
   * concept in one batch broke one rule, and every batch that had already
   * succeeded went with it.
   */
  it('retries a failed batch one concept at a time rather than failing the topic', async () => {
    const topic = await seedTopic();
    generateConceptMap.mockResolvedValueOnce(fakeMap(8));
    generateItemsBatch
      .mockRejectedValueOnce(new GenerationError('transfer_count', 'concept c1: at least one item must be marked as transfer'))
      .mockImplementation(async (i: Parameters<typeof fakeBatch>[0]) => fakeBatch(i));

    await expect(processGenerationJob({ topicId: topic.id }, seededRng(42))).resolves.toBeUndefined();

    const [after] = await db.select().from(topics).where(eq(topics.id, topic.id));
    expect(after?.status).toBe('active');

    // Nothing is skipped: the concepts in the failed batch still get their items.
    const rows = await db.select().from(concepts).where(eq(concepts.topicId, topic.id));
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      expect(await db.select().from(items).where(eq(items.conceptId, row.id))).not.toHaveLength(0);
    }

    // fakeMap(8) cycles four domains, so batches are pairs: the failed pair is
    // re-asked as two calls of one concept each.
    const sizes = generateItemsBatch.mock.calls.map(([input]) => (input as { concepts: unknown[] }).concepts.length);
    expect(sizes).toEqual([2, 1, 1, 2, 2, 2]);
  });

  it('does not split a batch that failed for a reason splitting cannot fix', async () => {
    const topic = await seedTopic();
    generateConceptMap.mockResolvedValueOnce(fakeMap(8));
    // Four identical failures help nobody, and the key is missing for the
    // single-concept call too.
    generateItemsBatch.mockRejectedValue(new GenerationError('missing_api_key', 'OPENAI_API_KEY is not set'));

    await expect(processGenerationJob({ topicId: topic.id }, seededRng(42))).rejects.toThrow(/missing_api_key/);
    expect(generateItemsBatch).toHaveBeenCalledTimes(1);
  });

  // T-120 — the control arm has to be answerable or it measures nothing.
  it('gives a held-out concept items but never teaching content', async () => {
    const topic = await seedTopic();
    generateFraming.mockResolvedValue(fakeFraming());
    generateConceptMap.mockResolvedValueOnce(fakeMap(20));
    generateItemsBatch.mockImplementation(async (i: Parameters<typeof fakeBatch>[0]) => fakeBatch(i));

    await processGenerationJob({ topicId: topic.id }, seededRng(42));

    const rows = await db.select().from(concepts).where(eq(concepts.topicId, topic.id));
    const held = rows.filter((r) => r.heldOut);
    const itemRows = await db.select().from(items);

    expect(held.length).toBeGreaterThan(0);
    for (const row of held) {
      // Askable on the Day-30 test...
      expect(itemRows.filter((i) => i.conceptId === row.id).length).toBeGreaterThan(0);
      // ...and unteachable. An explanation that exists is one something can
      // render, and the control arm's whole value is that it was never taught.
      expect(row.explanationShort).toBeNull();
      expect(row.explanationLong).toBeNull();
      expect(row.tryFirstPrompt).toBeNull();
    }
  });
});
