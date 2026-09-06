import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

const generateConceptMap = vi.fn();
const generateItems = vi.fn();
const generateTeaching = vi.fn();
vi.mock('../../generator/conceptMap.js', () => ({ generateConceptMap: (...a: unknown[]) => generateConceptMap(...a) }));
vi.mock('../../generator/items.js', () => ({ generateItems: (...a: unknown[]) => generateItems(...a) }));
vi.mock('../../generator/teaching.js', () => ({ generateTeaching: (...a: unknown[]) => generateTeaching(...a) }));

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
const { pickHeldOut, seededRng } = await import('../../lib/heldOut.js');
const { db } = await import('../../db/client.js');
const { concepts, conceptPrereqs, items, topics } = await import('../../db/schema.js');
const { seedUser, truncateAll } = await import('../../test/db.js');

/** n concepts in teaching order, each depending on the one before it. */
const DOMAINS = ['code', 'prose', 'systems', 'math'] as const;

function fakeMap(n: number) {
  return {
    topic: 'React Hooks',
    concepts: Array.from({ length: n }, (_, i) => ({
      slug: `c${i + 1}`,
      title: `Concept ${i + 1}`,
      summary: `summary ${i + 1}`,
      prereqs: i === 0 ? [] : [`c${i}`],
      // Cycled rather than fixed, so a worker that dropped the field or wrote
      // the same one for every row would fail the assertion below (T-082).
      domain: DOMAINS[i % DOMAINS.length] as (typeof DOMAINS)[number],
    })),
  };
}

const fakeItems = (topic: string) => ({
  topic,
  items: [
    { payload: { type: 'recall' as const, prompt: 'Q1', answer: 'A' }, isTransfer: false },
    {
      payload: { type: 'recognition' as const, prompt: 'Q2', options: ['a', 'b', 'c', 'd'], answerIndex: 0 },
      isTransfer: true,
    },
  ],
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
  generateItems.mockReset();
  generateTeaching.mockReset();
  // Default so tests that don't care about teaching content don't have to set
  // it up; a test asserting on teaching overrides this.
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

  it('picks max(1, floor(n * ratio)), capped at the eligible pool', () => {
    expect(pickHeldOut(ordered, 0.1, 3, seededRng(1)).size).toBe(2);
    // 5 concepts → floor(0.5) = 0 → the max(1, ...) floor applies.
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
    generateConceptMap.mockResolvedValueOnce(fakeMap(20));
    generateItems.mockImplementation(async (t: string) => fakeItems(t));

    await processGenerationJob({ topicId: topic.id }, seededRng(42));

    const rows = await db.select().from(concepts).where(eq(concepts.topicId, topic.id));
    expect(rows).toHaveLength(20);

    // exactly max(1, floor(20 * 0.1)) held out, none in the first 3 by order
    const held = rows.filter((r) => r.heldOut);
    expect(held).toHaveLength(2);
    expect(held.every((r) => r.order > 3)).toBe(true);

    // teach_mode set on every concept, and both values show up in 20
    expect(rows.every((r) => r.teachMode !== null)).toBe(true);
    expect(new Set(rows.map((r) => r.teachMode))).toEqual(new Set(['try_first', 'example_first']));

    // 19 edges for a 20-concept chain
    const prereqRows = await db.select().from(conceptPrereqs);
    expect(prereqRows).toHaveLength(19);

    // every held-out concept has 0 items; every taught one has items
    const itemRows = await db.select().from(items);
    const heldIds = new Set(held.map((r) => r.id));
    expect(itemRows.filter((i) => heldIds.has(i.conceptId))).toHaveLength(0);
    expect(itemRows).toHaveLength(18 * 2);
    expect(generateItems).toHaveBeenCalledTimes(18);

    const [after] = await db.select().from(topics).where(eq(topics.id, topic.id));
    expect(after?.status).toBe('active');
    expect(after?.error).toBeNull();
  });

  // T-053 — teaching content is what T-016's GET /session returns and T-021
  // renders, so it has to survive the same transaction as the map.
  it('persists teaching content for every taught concept', async () => {
    const topic = await seedTopic();
    generateConceptMap.mockResolvedValueOnce(fakeMap(20));
    generateItems.mockImplementation(async (t: string) => fakeItems(t));

    await processGenerationJob({ topicId: topic.id }, seededRng(42));

    const rows = await db.select().from(concepts).where(eq(concepts.topicId, topic.id));
    const taught = rows.filter((r) => !r.heldOut);

    expect(taught).toHaveLength(18);
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
    generateConceptMap.mockResolvedValueOnce(fakeMap(20));
    generateItems.mockImplementation(async (t: string) => fakeItems(t));

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
    expect(generateTeaching).toHaveBeenCalledTimes(18);
  });

  it('conditions the teaching prompt on the concept’s teach mode', async () => {
    const topic = await seedTopic();
    generateConceptMap.mockResolvedValueOnce(fakeMap(20));
    generateItems.mockImplementation(async (t: string) => fakeItems(t));

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
    generateConceptMap.mockResolvedValueOnce(fakeMap(20));
    generateItems.mockImplementation(async (t: string) => fakeItems(t));

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
    generateConceptMap.mockResolvedValueOnce(fakeMap(20));
    generateItems.mockImplementation(async (t: string) => fakeItems(t));

    await processGenerationJob({ topicId: withLanguage.id }, seededRng(42));

    expect(generateItems.mock.calls.length).toBeGreaterThan(0);
    for (const call of generateItems.mock.calls) {
      expect((call[0] as { language?: string }).language).toBe('Python');
    }
    for (const call of generateTeaching.mock.calls) {
      expect((call[0] as { language?: string }).language).toBe('Python');
    }

    generateConceptMap.mockReset();
    generateItems.mockReset();
    generateTeaching.mockReset();
    generateTeaching.mockImplementation(async ({ concept }: { concept: string }) => fakeTeaching(concept));

    const bare = await seedTopic();
    generateConceptMap.mockResolvedValueOnce(fakeMap(20));
    generateItems.mockImplementation(async (t: string) => fakeItems(t));

    await processGenerationJob({ topicId: bare.id }, seededRng(42));

    // Undefined, not '': the generator turns an absent language into an omitted
    // prompt line, and an empty string would be indistinguishable here.
    for (const call of generateItems.mock.calls) {
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
    generateConceptMap.mockResolvedValueOnce(fakeMap(20));
    generateItems.mockImplementation(async (t: string) => fakeItems(t));

    const progress: { stage: string; completed: number; total: number; concept?: string }[] = [];
    await processGenerationJob({ topicId: topic.id }, seededRng(42), (p) => {
      progress.push(p);
    });

    expect(progress[0]).toMatchObject({ stage: 'map', completed: 0 });

    // 18 taught concepts (2 of 20 are held out), one report each, monotonic.
    const content = progress.filter((p) => p.stage === 'content');
    expect(content.at(-1)).toMatchObject({ completed: 18, total: 18 });
    expect(content.map((p) => p.completed)).toEqual([0, ...Array.from({ length: 18 }, (_, i) => i + 1)]);
    expect(content.at(-1)?.concept).toBe('Concept 20');

    expect(progress.at(-1)).toMatchObject({ stage: 'saving', completed: 18, total: 18 });
  });

  it('does not require a progress reporter', async () => {
    const topic = await seedTopic();
    generateConceptMap.mockResolvedValueOnce(fakeMap(6));
    generateItems.mockImplementation(async (t: string) => fakeItems(t));

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
    generateConceptMap.mockResolvedValueOnce(fakeMap(20));
    generateItems
      .mockImplementationOnce(async (t: string) => fakeItems(t))
      .mockRejectedValueOnce(new Error('truncated: response hit max_tokens'));

    await expect(processGenerationJob({ topicId: topic.id }, seededRng(7))).rejects.toThrow(/truncated/);

    // The transaction is opened only after every model call returns, so a
    // mid-generation failure leaves no partial map behind.
    expect(await db.select().from(concepts).where(eq(concepts.topicId, topic.id))).toHaveLength(0);
    expect(await db.select().from(items)).toHaveLength(0);
    const [after] = await db.select().from(topics).where(eq(topics.id, topic.id));
    expect(after?.status).toBe('failed');
  });
});
