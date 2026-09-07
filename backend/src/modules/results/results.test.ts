import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { db } from '../../db/client.js';
import { concepts, tests, topics } from '../../db/schema.js';
import { seedUser, truncateAll } from '../../test/db.js';

const app = createApp();

let user: Awaited<ReturnType<typeof seedUser>>;
let topicId: string;
let taughtId: string;
let heldOutId: string;

beforeEach(async () => {
  await truncateAll();
  user = await seedUser();
  const [topic] = await db
    .insert(topics)
    .values({ userId: user.id, title: 'Distributed systems', status: 'active' })
    .returning({ id: topics.id });
  topicId = topic!.id;

  const [taught] = await db
    .insert(concepts)
    .values({ topicId, slug: 'leases', title: 'Leases', order: 1, heldOut: false })
    .returning({ id: concepts.id });
  const [held] = await db
    .insert(concepts)
    .values({ topicId, slug: 'quorum', title: 'Quorums', order: 2, heldOut: true })
    .returning({ id: concepts.id });
  taughtId = taught!.id;
  heldOutId = held!.id;
});

async function seedDay30(perConcept: Record<string, number>, over: Record<string, unknown> = {}) {
  await db.insert(tests).values({
    userId: user.id,
    topicId,
    kind: 'day30',
    itemIds: [],
    scores: { overall: 0.7, taught: 0.9, heldOut: 0.3, transfer: 0.5, calibrationGap: 0.15, perConcept, ...over },
  });
}

describe('GET /topics/:id/results', () => {
  it('reports taught against held-out', async () => {
    await seedDay30({});

    const res = await request(app).get(`/topics/${topicId}/results`).set('Cookie', user.cookie);

    expect(res.status).toBe(200);
    expect(res.body.taught).toBe(0.9);
    expect(res.body.heldOut).toBe(0.3);
  });

  it('lists every concept, flagging the ones we never taught', async () => {
    await seedDay30({ [taughtId]: 1, [heldOutId]: 0 });

    const res = await request(app).get(`/topics/${topicId}/results`).set('Cookie', user.cookie);

    expect(res.body.concepts).toHaveLength(2);
    expect(res.body.concepts[0]).toMatchObject({ title: 'Leases', heldOut: false, score: 1 });
    expect(res.body.concepts[1]).toMatchObject({ title: 'Quorums', heldOut: true, score: 0 });
  });

  it('scores a concept the test never asked about as null, not zero', async () => {
    // A 25-item test does not cover 16 concepts evenly. "We did not ask" and
    // "you got it wrong" must not look the same to the person reading this.
    await seedDay30({ [taughtId]: 1 });

    const res = await request(app).get(`/topics/${topicId}/results`).set('Cookie', user.cookie);

    expect(res.body.concepts[1].score).toBeNull();
  });

  it('says nothing before the Day-30 test rather than reporting zeros', async () => {
    const res = await request(app).get(`/topics/${topicId}/results`).set('Cookie', user.cookie);

    expect(res.status).toBe(200);
    expect(res.body.taught).toBeNull();
    expect(res.body.heldOut).toBeNull();
    expect(res.body.day45Pending).toBe(false);
  });

  it('promises the Day-45 check only while it is still ahead', async () => {
    await seedDay30({});
    const pending = await request(app).get(`/topics/${topicId}/results`).set('Cookie', user.cookie);
    expect(pending.body.day45Pending).toBe(true);

    await db.insert(tests).values({ userId: user.id, topicId, kind: 'day45', itemIds: [], scores: {} });
    const done = await request(app).get(`/topics/${topicId}/results`).set('Cookie', user.cookie);

    // A promise the product then fails to keep is worse than not making it.
    expect(done.body.day45Pending).toBe(false);
  });

  it('treats an ungraded Day-30 as no result at all', async () => {
    await db.insert(tests).values({ userId: user.id, topicId, kind: 'day30', itemIds: [], scores: {} });

    const res = await request(app).get(`/topics/${topicId}/results`).set('Cookie', user.cookie);

    expect(res.body.taught).toBeNull();
    expect(res.body.day45Pending).toBe(false);
  });

  it('will not show another learner their results', async () => {
    // This page is the most personal thing the product produces — a list of
    // what someone failed to remember.
    await seedDay30({});
    const stranger = await seedUser();

    const res = await request(app).get(`/topics/${topicId}/results`).set('Cookie', stranger.cookie);

    expect(res.status).toBe(404);
  });

  it('requires a user', async () => {
    expect((await request(app).get(`/topics/${topicId}/results`)).status).toBe(401);
  });
});
