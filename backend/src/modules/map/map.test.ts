import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../app.js';
import { db } from '../../db/client.js';
import { cards, conceptPrereqs, concepts, topics } from '../../db/schema.js';
import { seedUser, truncateAll } from '../../test/db.js';

const app = createApp();
const DAY = 86_400_000;
const HELD_OUT_TITLE = 'Secret held-out concept';

interface SeedOpts {
  count?: number;
  heldOutOrders?: number[];
  /** order -> stability, for concepts that should have a card. */
  taught?: Record<number, { stability: number; lastReviewDaysAgo?: number }>;
  /** order -> diagnostic estimate. >= 0.8 marks the concept "known". */
  estimates?: Record<number, number>;
  prereqs?: Record<number, number[]>;
}

async function seed(opts: SeedOpts = {}) {
  const { count = 4, heldOutOrders = [], taught = {}, estimates = {}, prereqs = {} } = opts;
  const user = await seedUser();

  const [topic] = await db
    .insert(topics)
    .values({ userId: user.id, title: 'React Hooks', status: 'active' })
    .returning({ id: topics.id });
  if (!topic) throw new Error('topic insert returned no row');

  const conceptRows = await db
    .insert(concepts)
    .values(
      Array.from({ length: count }, (_, i) => ({
        topicId: topic.id,
        slug: `c${i + 1}`,
        title: heldOutOrders.includes(i + 1) ? HELD_OUT_TITLE : `Concept ${i + 1}`,
        order: i + 1,
        heldOut: heldOutOrders.includes(i + 1),
      })),
    )
    .returning({ id: concepts.id, order: concepts.order });

  const byOrder = new Map(conceptRows.map((r) => [r.order, r.id]));

  const edges = Object.entries(prereqs).flatMap(([order, deps]) =>
    deps.map((dep) => ({
      conceptId: byOrder.get(Number(order)) as string,
      prerequisiteConceptId: byOrder.get(dep) as string,
    })),
  );
  if (edges.length > 0) await db.insert(conceptPrereqs).values(edges);

  const cardRows = Object.entries(taught).map(([order, spec]) => {
    const lastReview = new Date(Date.now() - (spec.lastReviewDaysAgo ?? 0) * DAY);
    return {
      userId: user.id,
      conceptId: byOrder.get(Number(order)) as string,
      due: new Date(Date.now() + DAY),
      stability: spec.stability,
      difficulty: 5,
      elapsedDays: 0,
      scheduledDays: 1,
      reps: 1,
      lapses: 0,
      state: 2,
      lastReview,
      taughtAt: lastReview,
    };
  });
  if (cardRows.length > 0) await db.insert(cards).values(cardRows);

  if (Object.keys(estimates).length > 0) {
    await db
      .update(topics)
      .set({
        diagnosticState: {
          estimates: Object.fromEntries(
            Object.entries(estimates).map(([order, value]) => [byOrder.get(Number(order)), value]),
          ),
          asked: [],
        },
      })
      .where(eq(topics.id, topic.id));
  }

  return { user, topicId: topic.id, byOrder };
}

const getMap = (cookie: string, topicId: string) =>
  request(app).get(`/topics/${topicId}/map`).set('Cookie', cookie);

beforeEach(async () => {
  await truncateAll();
});

describe('GET /topics/:id/map', () => {
  it('scores zero and reports everything untaught before any teaching', async () => {
    const { user, topicId } = await seed({ count: 4 });
    const res = await getMap(user.cookie, topicId);

    expect(res.status).toBe(200);
    expect(res.body.score).toBe(0);
    expect(res.body.concepts.every((c: { state: string }) => c.state === 'untaught')).toBe(true);
  });

  it('averages taught mastery into the score', async () => {
    // One card fresh (recall ~1), one long-stale (recall ~0.5) — asserted as a
    // range because FSRS decay is not a round number.
    const { user, topicId } = await seed({
      count: 2,
      taught: { 1: { stability: 100 }, 2: { stability: 10, lastReviewDaysAgo: 10 } },
    });
    const res = await getMap(user.cookie, topicId);

    expect(res.body.score).toBeGreaterThan(0);
    expect(res.body.score).toBeLessThan(100);
  });

  it('excludes untaught concepts from the mean', async () => {
    const { user, topicId } = await seed({ count: 10, taught: { 1: { stability: 100 } } });
    const res = await getMap(user.cookie, topicId);

    // Nine untaught concepts must not drag a single well-known one to 10.
    expect(res.body.score).toBeGreaterThan(90);
  });

  it('reports a concept the diagnostic found they already knew as known', async () => {
    const { user, topicId } = await seed({
      count: 2,
      taught: { 1: { stability: 100 }, 2: { stability: 100 } },
      estimates: { 1: 0.9, 2: 0.3 },
    });
    const states = (await getMap(user.cookie, topicId)).body.concepts.map(
      (c: { state: string }) => c.state,
    );
    expect(states).toEqual(['known', 'taught']);
  });

  it('never returns a held-out concept’s title', async () => {
    const { user, topicId } = await seed({ count: 4, heldOutOrders: [3] });
    const res = await getMap(user.cookie, topicId);

    const held = res.body.concepts.find((c: { state: string }) => c.state === 'heldout');
    expect(held.title).toBeNull();
    // Asserted against the serialised body too: key inspection alone would miss
    // a leak through some other field.
    expect(JSON.stringify(res.body)).not.toContain(HELD_OUT_TITLE);
  });

  it('keeps edges for held-out concepts — the graph shape is not the secret', async () => {
    const { user, topicId, byOrder } = await seed({
      count: 4,
      heldOutOrders: [3],
      prereqs: { 3: [2] },
    });
    const res = await getMap(user.cookie, topicId);

    expect(res.body.edges).toContainEqual({ from: byOrder.get(2), to: byOrder.get(3) });
  });

  it('flags only taught concepts that have slipped', async () => {
    const { user, topicId } = await seed({
      count: 3,
      taught: { 1: { stability: 100 }, 2: { stability: 0.5, lastReviewDaysAgo: 30 } },
    });
    const res = await getMap(user.cookie, topicId);

    const byOrderState = new Map(
      res.body.concepts.map((c: { order: number; atRisk: boolean; mastery: number }) => [c.order, c]),
    );
    expect((byOrderState.get(1) as { atRisk: boolean }).atRisk).toBe(false);
    expect((byOrderState.get(2) as { atRisk: boolean }).atRisk).toBe(true);
    // Untaught, so never at risk however low its mastery reads.
    expect((byOrderState.get(3) as { atRisk: boolean }).atRisk).toBe(false);
  });

  it('returns concepts in teaching order', async () => {
    const { user, topicId } = await seed({ count: 5 });
    const orders = (await getMap(user.cookie, topicId)).body.concepts.map(
      (c: { order: number }) => c.order,
    );
    expect(orders).toEqual([1, 2, 3, 4, 5]);
  });

  it('404s another user’s topic rather than confirming it exists', async () => {
    const { topicId } = await seed({ count: 3 });
    const other = await seedUser();
    expect((await getMap(other.cookie, topicId)).status).toBe(404);
  });

  it('400s a malformed topic id before it reaches a uuid column', async () => {
    const { user } = await seed({ count: 2 });
    expect((await getMap(user.cookie, 'not-a-uuid')).status).toBe(400);
  });

  it('requires authentication', async () => {
    const { topicId } = await seed({ count: 2 });
    expect((await request(app).get(`/topics/${topicId}/map`)).status).toBe(401);
  });
});
