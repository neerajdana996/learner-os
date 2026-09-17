import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../app.js';
import { db } from '../../db/client.js';
import { concepts, items, topics } from '../../db/schema.js';
import { seedUser, truncateAll } from '../../test/db.js';
import { once } from 'node:events';
import { Worker } from 'bullmq';
import { closeGenerationQueue, getGenerationQueue } from '../../workers/queue.js';
import { GENERATION_QUEUE } from '../../workers/generator.worker.js';
import { processLifecycle } from '../../workers/lifecycle.worker.js';
import { env } from '../../lib/env.js';
import { STRANDED_AFTER_MS, STRANDED_ERROR } from '../../lib/stranded.js';
import { failStrandedTopics } from './topics.service.js';

const app = createApp();

/** A valid 30-day span, comfortably over TopicCreateSchema's 7-day minimum. */
const validSpan = {
  startsAt: '2026-01-01T00:00:00.000Z',
  endsAt: '2026-01-31T00:00:00.000Z',
};

beforeEach(async () => {
  await truncateAll();
  await getGenerationQueue().obliterate({ force: true });
});

afterAll(async () => {
  await closeGenerationQueue();
});

describe('POST /topics', () => {
  it('rejects a 6-day span with 400', async () => {
    const user = await seedUser();
    const res = await request(app)
      .post('/topics')
      .set('Cookie', user.cookie)
      .send({ title: 'React Hooks', startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2026-01-07T00:00:00.000Z' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation');
    expect(await db.select().from(topics)).toHaveLength(0);
  });

  it('accepts a valid topic: 202, row is generating, one job queued', async () => {
    const user = await seedUser();
    const res = await request(app)
      .post('/topics')
      .set('Cookie', user.cookie)
      .send({ title: 'React Hooks', why: 'to stop googling useEffect', ...validSpan });

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'generating' });
    expect(res.body.topicId).toEqual(expect.any(String));

    const rows = await db.select().from(topics).where(eq(topics.id, res.body.topicId));
    expect(rows[0]?.status).toBe('generating');
    expect(rows[0]?.userId).toBe(user.id);
    expect(rows[0]?.why).toBe('to stop googling useEffect');

    const jobs = await getGenerationQueue().getJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toEqual({ topicId: res.body.topicId });
  });

  // T-091 — the learner picks the language.
  it('persists the language when given one, and null when not', async () => {
    const user = await seedUser();
    const withLanguage = await request(app)
      .post('/topics')
      .set('Cookie', user.cookie)
      .send({ title: 'Dynamic programming', language: 'Python', ...validSpan });

    expect(withLanguage.status).toBe(202);
    const [chosen] = await db.select().from(topics).where(eq(topics.id, withLanguage.body.topicId));
    expect(chosen?.language).toBe('Python');

    // A second learner, because the same one cannot hold two generating topics
    // (T-065) — the guard would hand back the first and prove nothing.
    const other = await seedUser();
    const without = await request(app)
      .post('/topics')
      .set('Cookie', other.cookie)
      .send({ title: 'Consistency in distributed systems', ...validSpan });

    expect(without.status).toBe(202);
    const [bare] = await db.select().from(topics).where(eq(topics.id, without.body.topicId));
    expect(bare?.language).toBeNull();
  });

  it('returns the topic already generating instead of building a second one', async () => {
    const user = await seedUser();
    const body = { title: 'Dynamic programming', ...validSpan };

    // The wait screen sits for five to ten minutes, so a second click is not a
    // rare accident — and it used to cost a second full generation (T-065).
    const first = await request(app).post('/topics').set('Cookie', user.cookie).send(body);
    const second = await request(app).post('/topics').set('Cookie', user.cookie).send(body);

    expect(second.status).toBe(202);
    expect(second.body.topicId).toBe(first.body.topicId);
    expect(await db.select().from(topics)).toHaveLength(1);
    expect(await getGenerationQueue().getJobs()).toHaveLength(1);
  });

  it('several concurrent requests still leave exactly one topic', async () => {
    // The sequential test above awaits each response before firing the next,
    // so it only ever exercised the check-then-insert on its own — never two
    // requests both reaching the SELECT before either had committed an
    // INSERT. `Promise.all` here is closer to a real double-click, though a
    // local Postgres round trip is fast enough that even this rarely forces
    // that interleaving in-process; the reliable repro was the browser E2E
    // test (`e2e/web/onboarding.spec.ts`, "double-clicking 'Build my map'"),
    // which has enough real latency to lose the race every time. This test
    // is kept alongside it as a cheap assertion that the invariant holds
    // under concurrent load, not as the thing that caught the bug.
    const user = await seedUser();
    const body = { title: 'Dynamic programming', ...validSpan };

    const responses = await Promise.all(
      Array.from({ length: 8 }, () => request(app).post('/topics').set('Cookie', user.cookie).send(body)),
    );

    for (const res of responses) expect(res.status).toBe(202);
    const topicIds = new Set(responses.map((r) => r.body.topicId));
    expect(topicIds.size).toBe(1);
    expect(await db.select().from(topics)).toHaveLength(1);
    expect(await getGenerationQueue().getJobs()).toHaveLength(1);
  });

  it('builds a new topic once the previous one is no longer generating', async () => {
    const user = await seedUser();
    const first = await request(app)
      .post('/topics')
      .set('Cookie', user.cookie)
      .send({ title: 'Sliding window', ...validSpan });
    await db.update(topics).set({ status: 'active' }).where(eq(topics.id, first.body.topicId));

    const second = await request(app)
      .post('/topics')
      .set('Cookie', user.cookie)
      .send({ title: 'Dynamic programming', ...validSpan });

    expect(second.body.topicId).not.toBe(first.body.topicId);
    expect(await db.select().from(topics)).toHaveLength(2);
  });

  it('does not let one user block another user from creating a topic', async () => {
    const first = await seedUser();
    const second = await seedUser();
    await request(app).post('/topics').set('Cookie', first.cookie).send({ title: 'A topic', ...validSpan });

    const res = await request(app)
      .post('/topics')
      .set('Cookie', second.cookie)
      .send({ title: 'Another topic', ...validSpan });

    expect(res.status).toBe(202);
    expect(await db.select().from(topics)).toHaveLength(2);
  });

  it('accepts the Sprint 1 demo body — title only', async () => {
    const user = await seedUser();
    const res = await request(app).post('/topics').set('Cookie', user.cookie).send({ title: 'React Hooks' });

    expect(res.status).toBe(202);
    expect(await getGenerationQueue().getJobs()).toHaveLength(1);
  });

  it('requires a user', async () => {
    const res = await request(app).post('/topics').send({ title: 'React Hooks' });
    expect(res.status).toBe(401);
  });
});

describe('GET /topics/:id', () => {
  it('returns status and zero counts while generating', async () => {
    const user = await seedUser();
    const created = await request(app).post('/topics').set('Cookie', user.cookie).send({ title: 'React Hooks' });

    const res = await request(app).get(`/topics/${created.body.topicId}`).set('Cookie', user.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: created.body.topicId,
      title: 'React Hooks',
      status: 'generating',
      counts: { concepts: 0, items: 0 },
    });
  });

  it('counts concepts and items once generation has persisted them', async () => {
    const user = await seedUser();
    const created = await request(app).post('/topics').set('Cookie', user.cookie).send({ title: 'React Hooks' });
    const topicId = created.body.topicId;

    const inserted = await db
      .insert(concepts)
      .values([
        { topicId, slug: 'a', title: 'A', order: 1 },
        { topicId, slug: 'b', title: 'B', order: 2 },
      ])
      .returning({ id: concepts.id });
    await db.insert(items).values(
      inserted.map((c) => ({
        conceptId: c.id,
        type: 'recall' as const,
        payload: { type: 'recall', prompt: 'Q', answer: 'A' },
      })),
    );

    const res = await request(app).get(`/topics/${topicId}`).set('Cookie', user.cookie);
    expect(res.body.counts).toEqual({ concepts: 2, items: 2 });
  });

  it('reports generation progress while the job is running', async () => {
    const user = await seedUser();
    const created = await request(app)
      .post('/topics')
      .set('Cookie', user.cookie)
      .send({ title: 'React Hooks', ...validSpan });

    const job = await getGenerationQueue().getJob(created.body.topicId);
    await job?.updateProgress({ stage: 'content', completed: 7, total: 36, concept: 'Memoisation' });

    const res = await request(app).get(`/topics/${created.body.topicId}`).set('Cookie', user.cookie);

    // The counter the wait screen used to show is 0 for the whole run, because
    // persistence is all-or-nothing (T-064). This is the number that moves.
    expect(res.body.counts.concepts).toBe(0);
    expect(res.body.progress).toEqual({
      stage: 'content',
      completed: 7,
      total: 36,
      concept: 'Memoisation',
    });
  });

  it('has no progress before the job reports any, and none once terminal', async () => {
    const user = await seedUser();
    const created = await request(app)
      .post('/topics')
      .set('Cookie', user.cookie)
      .send({ title: 'React Hooks', ...validSpan });

    const fresh = await request(app).get(`/topics/${created.body.topicId}`).set('Cookie', user.cookie);
    expect(fresh.status).toBe(200);
    expect(fresh.body.progress).toBeNull();

    // A finished topic's job is eventually evicted from Redis, so asking for it
    // must be a normal empty answer rather than a 500.
    await db.update(topics).set({ status: 'active' }).where(eq(topics.id, created.body.topicId));
    await getGenerationQueue().obliterate({ force: true });

    const done = await request(app).get(`/topics/${created.body.topicId}`).set('Cookie', user.cookie);
    expect(done.status).toBe(200);
    expect(done.body.progress).toBeNull();
  });

  it('404s for a topic owned by someone else', async () => {
    const owner = await seedUser();
    const other = await seedUser();
    const created = await request(app).post('/topics').set('Cookie', owner.cookie).send({ title: 'React Hooks' });

    const res = await request(app).get(`/topics/${created.body.topicId}`).set('Cookie', other.cookie);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
  });

  it('400s on a malformed id instead of hitting the uuid column', async () => {
    const user = await seedUser();
    const res = await request(app).get('/topics/not-a-uuid').set('Cookie', user.cookie);
    expect(res.status).toBe(400);
  });
});

describe('GET /topics', () => {
  it('lists only the caller\'s topics, newest first', async () => {
    const user = await seedUser();
    const other = await seedUser();

    // One at a time: a second POST while the first is still generating returns
    // the first (T-065), so the fixture flips it out of `generating` the way a
    // finished job would.
    const first = await request(app).post('/topics').set('Cookie', user.cookie).send({ title: 'First' });
    await db.update(topics).set({ status: 'active' }).where(eq(topics.id, first.body.topicId));
    await request(app).post('/topics').set('Cookie', user.cookie).send({ title: 'Second' });
    await request(app).post('/topics').set('Cookie', other.cookie).send({ title: 'Not mine' });

    const res = await request(app).get('/topics').set('Cookie', user.cookie);

    expect(res.status).toBe(200);
    expect(res.body.topics.map((t: { title: string }) => t.title)).toEqual(['Second', 'First']);
  });
});

/**
 * T-069. A topic whose generation job died stayed `generating` forever, and
 * T-065's guard then handed that dead row back to every attempt to start over.
 */
describe('stranded generation', () => {
  const now = new Date();
  const longAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);

  async function seedGenerating(userId: string, createdAt = longAgo) {
    const [row] = await db
      .insert(topics)
      .values({ userId, title: 'Dynamic programming', status: 'generating', createdAt })
      .returning();
    return row!;
  }

  async function statusOf(id: string) {
    const [row] = await db.select().from(topics).where(eq(topics.id, id));
    return { status: row?.status, error: row?.error };
  }

  it('marks a generating topic with no job, past the threshold, failed and says why', async () => {
    const user = await seedUser();
    const topic = await seedGenerating(user.id);

    expect(await failStrandedTopics(now)).toBe(1);

    expect(await statusOf(topic.id)).toEqual({ status: 'failed', error: STRANDED_ERROR });
  });

  it('leaves a topic with a live job alone, however long it has been running', async () => {
    const user = await seedUser();
    const topic = await seedGenerating(user.id);
    // No worker runs in this file, so the job waits — alive, just slow.
    await getGenerationQueue().add('generate', { topicId: topic.id }, { jobId: topic.id });

    expect(await failStrandedTopics(now)).toBe(0);

    expect((await statusOf(topic.id)).status).toBe('generating');
  });

  it('leaves a topic younger than the threshold alone, without asking the queue', async () => {
    const user = await seedUser();
    // Committed, not yet enqueued: the gap T-065 deliberately leaves.
    const topic = await seedGenerating(user.id, new Date(now.getTime() - STRANDED_AFTER_MS + 1000));
    const jobState = async () => {
      throw new Error('a young topic must not cost a Redis round trip');
    };

    expect(await failStrandedTopics(now, { jobState })).toBe(0);
    expect((await statusOf(topic.id)).status).toBe('generating');
  });

  /** The commonest real case: a worker killed mid-job. BullMQ's stall checker
   *  moves that job to `failed` without the job's catch block ever running, so
   *  a job still exists — it is just dead. */
  it('marks a topic failed when its job exists but died', async () => {
    const user = await seedUser();
    const topic = await seedGenerating(user.id);
    await getGenerationQueue().add('generate', { topicId: topic.id }, { jobId: topic.id });

    const dying = new Worker(
      GENERATION_QUEUE,
      async () => {
        throw new Error('job stalled more than allowable limit');
      },
      { connection: { url: env.REDIS_URL } },
    );
    await once(dying, 'failed');
    await dying.close();
    expect(await (await getGenerationQueue().getJob(topic.id))!.getState()).toBe('failed');

    expect(await failStrandedTopics(now)).toBe(1);
    expect((await statusOf(topic.id)).status).toBe('failed');
  });

  it('marks nothing when the queue cannot be asked', async () => {
    const user = await seedUser();
    const topic = await seedGenerating(user.id);
    const jobState = async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:6379');
    };

    expect(await failStrandedTopics(now, { jobState })).toBe(0);
    expect((await statusOf(topic.id)).status).toBe('generating');
  });

  it('does not block POST /topics from creating a new one', async () => {
    const user = await seedUser();
    const stranded = await seedGenerating(user.id);

    const res = await request(app)
      .post('/topics')
      .set('Cookie', user.cookie)
      .send({ title: 'Dynamic programming', ...validSpan });

    expect(res.status).toBe(202);
    expect(res.body.topicId).not.toBe(stranded.id);
    expect((await statusOf(stranded.id)).status).toBe('failed');
    const jobs = await getGenerationQueue().getJobs();
    expect(jobs.map((job) => job.data.topicId)).toEqual([res.body.topicId]);
  });

  it('only touches the requesting learner when run for one user', async () => {
    const mine = await seedUser();
    const theirs = await seedUser();
    await seedGenerating(mine.id);
    const other = await seedGenerating(theirs.id);

    expect(await failStrandedTopics(now, { userId: mine.id })).toBe(1);
    expect((await statusOf(other.id)).status).toBe('generating');
  });

  it('is swept by the lifecycle tick, with nobody running SQL', async () => {
    const user = await seedUser();
    const topic = await seedGenerating(user.id);

    await processLifecycle(now);

    expect(await statusOf(topic.id)).toEqual({ status: 'failed', error: STRANDED_ERROR });
  });
});

