import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { TopicListResponseSchema, TopicSummarySchema } from '@learnos/shared';
import { createApp } from '../../app.js';
import { db } from '../../db/client.js';
import { topics } from '../../db/schema.js';
import { seedUser, truncateAll } from '../../test/db.js';
import { closeGenerationQueue } from '../../workers/queue.js';
import { listTopics } from './topics.repository.js';

/**
 * T-075, end to end: a controller that stops sending a field fails its own
 * test, instead of arriving as `undefined` three screens away.
 *
 * `listTopics` is wrapped rather than replaced, so every other test here runs
 * the real query; the one that needs T-072's bug back strips a column from
 * the real rows for a single call.
 */
vi.mock('./topics.repository.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./topics.repository.js')>();
  return { ...actual, listTopics: vi.fn(actual.listTopics) };
});

const app = createApp();

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeGenerationQueue();
});

async function seedActiveTopic() {
  const user = await seedUser();
  const [topic] = await db
    .insert(topics)
    .values({
      userId: user.id,
      title: 'Dynamic programming',
      status: 'active',
      startsAt: new Date('2026-01-01T00:00:00Z'),
      endsAt: new Date('2026-01-31T00:00:00Z'),
    })
    .returning();
  return { user, topic: topic! };
}

describe('topic responses match their shared schemas', () => {
  it('GET /topics parses as TopicListResponse, progress included', async () => {
    const { user } = await seedActiveTopic();
    const res = await request(app).get('/topics').set('Cookie', user.cookie);

    expect(res.status).toBe(200);
    expect(TopicListResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.topics[0].progress).toBeNull();
  });

  it('GET /topics/:id parses as TopicSummary', async () => {
    const { user, topic } = await seedActiveTopic();
    const res = await request(app).get(`/topics/${topic.id}`).set('Cookie', user.cookie);

    expect(res.status).toBe(200);
    expect(TopicSummarySchema.safeParse(res.body).success).toBe(true);
  });

  it('fails loudly when the list query drops a field', async () => {
    const { user } = await seedActiveTopic();
    const actual = await vi.importActual<typeof import('./topics.repository.js')>('./topics.repository.js');
    // T-072, reintroduced: the select no longer includes `endsAt`.
    vi.mocked(listTopics).mockImplementationOnce(
      (async (userId: string) =>
        (await actual.listTopics(userId)).map(({ endsAt: _dropped, ...row }) => row)) as unknown as typeof listTopics,
    );

    const res = await request(app).get('/topics').set('Cookie', user.cookie);

    expect(res.status).toBe(500);
    expect(res.body.message).toMatch(/GET \/topics.*topics\.0\.endsAt/);
  });
});
