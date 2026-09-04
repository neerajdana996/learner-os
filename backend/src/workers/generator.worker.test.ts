import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

const generateConceptMap = vi.fn();
const generateItems = vi.fn();
vi.mock('../generator/conceptMap.js', () => ({ generateConceptMap: (...a: unknown[]) => generateConceptMap(...a) }));
vi.mock('../generator/items.js', () => ({ generateItems: (...a: unknown[]) => generateItems(...a) }));

const { processGenerationJob } = await import('./generator.worker.js');
const { pickHeldOut, seededRng } = await import('../lib/heldOut.js');
const { db } = await import('../db/client.js');
const { concepts, conceptPrereqs, items, topics } = await import('../db/schema.js');
const { seedUser, truncateAll } = await import('../test/db.js');

/** n concepts in teaching order, each depending on the one before it. */
function fakeMap(n: number) {
  return {
    topic: 'React Hooks',
    concepts: Array.from({ length: n }, (_, i) => ({
      slug: `c${i + 1}`,
      title: `Concept ${i + 1}`,
      summary: `summary ${i + 1}`,
      prereqs: i === 0 ? [] : [`c${i}`],
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

async function seedTopic() {
  const user = await seedUser();
  const [topic] = await db
    .insert(topics)
    .values({ userId: user.id, title: 'React Hooks' })
    .returning({ id: topics.id });
  if (!topic) throw new Error('topic insert returned no row');
  return topic;
}

beforeEach(async () => {
  generateConceptMap.mockReset();
  generateItems.mockReset();
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
