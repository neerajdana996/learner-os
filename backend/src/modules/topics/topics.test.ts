import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../app.js';
import { db } from '../../db/client.js';
import { concepts, items, topics } from '../../db/schema.js';
import { seedUser, truncateAll } from '../../test/db.js';
import { closeGenerationQueue, getGenerationQueue } from '../../workers/queue.js';

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

    await request(app).post('/topics').set('Cookie', user.cookie).send({ title: 'First' });
    await request(app).post('/topics').set('Cookie', user.cookie).send({ title: 'Second' });
    await request(app).post('/topics').set('Cookie', other.cookie).send({ title: 'Not mine' });

    const res = await request(app).get('/topics').set('Cookie', user.cookie);

    expect(res.status).toBe(200);
    expect(res.body.topics.map((t: { title: string }) => t.title)).toEqual(['Second', 'First']);
  });
});
