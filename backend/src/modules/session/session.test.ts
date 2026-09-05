import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { createApp } from '../../app.js';
import { db } from '../../db/client.js';
import { cards, conceptPrereqs, concepts, items, sessionDays, topics } from '../../db/schema.js';
import { seedUser, truncateAll } from '../../test/db.js';

const app = createApp();
const DAY = 86_400_000;

interface SeedOpts {
  count?: number;
  days?: number;
  budget?: number;
  heldOutOrders?: number[];
  /** order -> orders it depends on. Default: a flat map with no prereqs. */
  prereqs?: Record<number, number[]>;
  /** Orders already taught, so they can come up as due reviews. */
  taughtOrders?: number[];
  /** Taught cards due this far in the past (ms). */
  dueAgo?: number;
}

async function seed(opts: SeedOpts = {}) {
  const {
    count = 20,
    days = 10,
    budget = 15,
    heldOutOrders = [],
    prereqs = {},
    taughtOrders = [],
    dueAgo = DAY,
  } = opts;

  const user = await seedUser();
  const [topic] = await db
    .insert(topics)
    .values({
      userId: user.id,
      title: 'React Hooks',
      status: 'active',
      endsAt: new Date(Date.now() + days * DAY),
      dailyBudgetMin: budget,
    })
    .returning({ id: topics.id });
  if (!topic) throw new Error('topic insert returned no row');

  const rows = await db
    .insert(concepts)
    .values(
      Array.from({ length: count }, (_, i) => ({
        topicId: topic.id,
        slug: `c${i + 1}`,
        title: `Concept ${i + 1}`,
        order: i + 1,
        heldOut: heldOutOrders.includes(i + 1),
        teachMode: (i % 2 === 0 ? 'try_first' : 'example_first') as 'try_first' | 'example_first',
        tryFirstPrompt: `Try ${i + 1}?`,
        explanationShort: `Short ${i + 1}.`,
        explanationLong: `Long ${i + 1}, with rather more detail than the short one.`,
        corrections: [{ wrong: 'a mistake', why: 'because' }],
      })),
    )
    .returning({ id: concepts.id, order: concepts.order });

  const byOrder = new Map(rows.map((r) => [r.order, r.id]));

  const edges = Object.entries(prereqs).flatMap(([order, deps]) =>
    deps.map((dep) => ({
      conceptId: byOrder.get(Number(order)) as string,
      prerequisiteConceptId: byOrder.get(dep) as string,
    })),
  );
  if (edges.length > 0) await db.insert(conceptPrereqs).values(edges);

  await db.insert(items).values(
    rows.map((r) => ({
      conceptId: r.id,
      type: 'recall' as const,
      payload: { type: 'recall', prompt: 'q', answer: 'the answer', accept: [] },
      isTransfer: false,
    })),
  );

  if (taughtOrders.length > 0) {
    await db.insert(cards).values(
      taughtOrders.map((order) => ({
        userId: user.id,
        conceptId: byOrder.get(order) as string,
        due: new Date(Date.now() - dueAgo),
        taughtAt: new Date(Date.now() - 2 * DAY),
      })),
    );
  }

  return { user, topicId: topic.id, byOrder };
}

const getSession = (cookie: string) => request(app).get('/session').set('Cookie', cookie);
const complete = (cookie: string, conceptIds: string[]) =>
  request(app).post('/session/complete').set('Cookie', cookie).send({ conceptIds });

beforeEach(async () => {
  await truncateAll();
});

describe('GET /session', () => {
  it('paces new concepts to finish by the end date', async () => {
    const { user } = await seed({ count: 20, days: 10 });
    const res = await getSession(user.cookie);

    expect(res.status).toBe(200);
    expect(res.body.newConcepts).toHaveLength(2);
  });

  it('caps at three however far behind the schedule is', async () => {
    const { user } = await seed({ count: 20, days: 2 });
    expect((await getSession(user.cookie)).body.newConcepts).toHaveLength(3);
  });

  it('trims new concepts to fit a small budget, and fills the rest with reviews', async () => {
    const { user } = await seed({ count: 20, days: 2, budget: 5, taughtOrders: [1, 2, 3, 4] });
    const res = await getSession(user.cookie);

    // 5 min = 300s: one new concept (180s) leaves 120s, i.e. two reviews.
    expect(res.body.newConcepts).toHaveLength(1);
    expect(res.body.dueReviews).toHaveLength(2);
  });

  it('does not offer a concept whose prerequisite is untaught', async () => {
    // 2 and 3 both depend on 1, which nobody has been taught.
    const { user, byOrder } = await seed({ count: 5, days: 5, prereqs: { 2: [1], 3: [1] } });
    const res = await getSession(user.cookie);

    const offered = res.body.newConcepts.map((c: { conceptId: string }) => c.conceptId);
    expect(offered).toContain(byOrder.get(1));
    expect(offered).not.toContain(byOrder.get(2));
    expect(offered).not.toContain(byOrder.get(3));
  });

  it('offers a concept once its prerequisite has been taught', async () => {
    const { user, byOrder } = await seed({
      count: 5,
      days: 5,
      prereqs: { 2: [1] },
      taughtOrders: [1],
    });
    const offered = (await getSession(user.cookie)).body.newConcepts.map(
      (c: { conceptId: string }) => c.conceptId,
    );
    expect(offered).toContain(byOrder.get(2));
  });

  it('never offers a held-out concept', async () => {
    const { user, byOrder } = await seed({ count: 10, days: 1, heldOutOrders: [1, 2] });
    const offered = (await getSession(user.cookie)).body.newConcepts.map(
      (c: { conceptId: string }) => c.conceptId,
    );

    expect(offered).not.toContain(byOrder.get(1));
    expect(offered).not.toContain(byOrder.get(2));
  });

  it('carries the teaching content the session screen renders', async () => {
    const { user } = await seed({ count: 6, days: 3 });
    const [concept] = (await getSession(user.cookie)).body.newConcepts;

    expect(concept.explanationShort).toBeTruthy();
    expect(concept.explanationLong.length).toBeGreaterThan(concept.explanationShort.length);
    expect(concept.corrections.length).toBeGreaterThan(0);
    expect(['try_first', 'example_first']).toContain(concept.teachMode);
  });

  it('never leaks an answer key', async () => {
    const { user } = await seed({ count: 6, days: 3, taughtOrders: [1] });
    const res = await getSession(user.cookie);

    expect(JSON.stringify(res.body)).not.toContain('the answer');
    for (const concept of res.body.newConcepts) {
      expect(concept.item).not.toHaveProperty('answer');
      expect(concept.item).not.toHaveProperty('accept');
    }
  });

  it('returns an empty plan rather than an error when there is nothing to do', async () => {
    const { user } = await seed({ count: 2, days: 5, taughtOrders: [1, 2], dueAgo: -DAY });
    const res = await getSession(user.cookie);

    expect(res.status).toBe(200);
    expect(res.body.newConcepts).toEqual([]);
    expect(res.body.dueReviews).toEqual([]);
  });

  it('404s when the user has no active topic', async () => {
    const user = await seedUser();
    expect((await getSession(user.cookie)).status).toBe(404);
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/session')).status).toBe(401);
  });
});

describe('POST /session/complete', () => {
  it('marks the concepts taught and schedules them for today', async () => {
    const { user, byOrder } = await seed({ count: 20, days: 10 });
    const offered = (await getSession(user.cookie)).body.newConcepts.map(
      (c: { conceptId: string }) => c.conceptId,
    );

    const res = await complete(user.cookie, offered);
    expect(res.status).toBe(200);

    const rows = await db.select().from(cards).where(eq(cards.userId, user.id));
    expect(rows).toHaveLength(offered.length);
    for (const row of rows) {
      expect(row.taughtAt).not.toBeNull();
      // due ≈ now, so the extension can ask about it later the same day.
      expect(Math.abs(row.due.getTime() - Date.now())).toBeLessThan(60_000);
    }
    expect(byOrder.size).toBeGreaterThan(0);
  });

  it('reports completedToday afterwards', async () => {
    const { user } = await seed({ count: 6, days: 3 });
    const offered = (await getSession(user.cookie)).body.newConcepts.map(
      (c: { conceptId: string }) => c.conceptId,
    );
    await complete(user.cookie, offered);

    expect((await getSession(user.cookie)).body.completedToday).toBe(true);
  });

  it('is idempotent for the same local day', async () => {
    const { user } = await seed({ count: 6, days: 3 });
    const offered = (await getSession(user.cookie)).body.newConcepts.map(
      (c: { conceptId: string }) => c.conceptId,
    );

    await complete(user.cookie, offered);
    const second = await complete(user.cookie, []);

    expect(second.status).toBe(200);
    expect(await db.select().from(sessionDays)).toHaveLength(1);
  });

  it('rejects a concept that was not offered today', async () => {
    // Order 20 exists but is far down the map, so today's plan never included it.
    const { user, byOrder } = await seed({ count: 20, days: 10 });
    const res = await complete(user.cookie, [byOrder.get(20) as string]);

    // Without this a client could post every id in the topic and mark the whole
    // course taught, skipping the teaching but still counting toward retention.
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('not_offered');
    expect(await db.select().from(cards)).toHaveLength(0);
  });

  it('rejects a held-out concept outright', async () => {
    const { user, byOrder } = await seed({ count: 10, days: 5, heldOutOrders: [4] });
    const res = await complete(user.cookie, [byOrder.get(4) as string]);

    expect(res.status).toBe(400);
    expect(await db.select().from(cards)).toHaveLength(0);
  });

  it('rejects another user’s concept', async () => {
    const { byOrder } = await seed({ count: 6, days: 3 });
    const other = await seedUser();
    await db.insert(topics).values({ userId: other.id, title: 'Theirs', status: 'active' });

    const res = await complete(other.cookie, [byOrder.get(1) as string]);
    expect(res.status).toBe(400);
    expect(await db.select().from(cards)).toHaveLength(0);
  });

  it('does not reset the schedule of a concept already being reviewed', async () => {
    const { user, byOrder } = await seed({ count: 6, days: 3, prereqs: { 2: [1] }, taughtOrders: [1] });
    const [before] = await db
      .select()
      .from(cards)
      .where(and(eq(cards.userId, user.id), eq(cards.conceptId, byOrder.get(1) as string)));

    // Replay an already-taught concept; taughtAt must survive.
    await complete(user.cookie, []);
    const [after] = await db
      .select()
      .from(cards)
      .where(and(eq(cards.userId, user.id), eq(cards.conceptId, byOrder.get(1) as string)));

    expect(after?.taughtAt?.getTime()).toBe(before?.taughtAt?.getTime());
  });

  it('requires authentication', async () => {
    expect((await request(app).post('/session/complete').send({ conceptIds: [] })).status).toBe(401);
  });
});
