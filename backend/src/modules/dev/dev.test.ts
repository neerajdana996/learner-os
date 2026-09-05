import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { createApp } from '../../app.js';
import { db } from '../../db/client.js';
import { cards, concepts, items, reviewEvents, sessionDays, topics } from '../../db/schema.js';
import { seedUser, truncateAll } from '../../test/db.js';

const app = createApp();

/** A learner mid-course: a topic with content, a taught card, an answer and a
 *  completed day. */
async function learnerWithProgress() {
  const user = await seedUser();
  const [topic] = await db
    .insert(topics)
    .values({ userId: user.id, title: 'React Hooks', status: 'active', diagnosticState: { asked: ['x'] } })
    .returning();
  if (!topic) throw new Error('no topic');

  const [concept] = await db
    .insert(concepts)
    .values({ topicId: topic.id, slug: 'usestate', title: 'useState', order: 1 })
    .returning();
  if (!concept) throw new Error('no concept');

  const [item] = await db
    .insert(items)
    .values({
      conceptId: concept.id,
      type: 'recall',
      payload: { type: 'recall', prompt: 'q', answer: 'a' },
    })
    .returning();
  if (!item) throw new Error('no item');

  const [card] = await db
    .insert(cards)
    .values({ userId: user.id, conceptId: concept.id, due: new Date(), taughtAt: new Date() })
    .returning();

  await db.insert(reviewEvents).values({
    userId: user.id,
    conceptId: concept.id,
    itemId: item.id,
    cardId: card?.id ?? null,
    correct: true,
    surface: 'web',
    predictedRecall: 0.5,
  });
  await db.insert(sessionDays).values({ userId: user.id, topicId: topic.id, day: '2026-09-05' });

  return { user, topic, concept, item };
}

beforeEach(async () => {
  await truncateAll();
});

describe('POST /dev/reset', () => {
  it('scope=progress keeps the generated course and clears the work', async () => {
    const { user, topic, concept, item } = await learnerWithProgress();

    const res = await request(app).post('/dev/reset').set('Cookie', user.cookie).send({ scope: 'progress' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ reviewEvents: 1, cards: 1 });

    // Generation survives — that is the point: it costs money and nine minutes.
    expect(await db.select().from(topics).where(eq(topics.id, topic.id))).toHaveLength(1);
    expect(await db.select().from(concepts).where(eq(concepts.id, concept.id))).toHaveLength(1);
    expect(await db.select().from(items).where(eq(items.id, item.id))).toHaveLength(1);

    // The work is gone, diagnostic walk included.
    expect(await db.select().from(reviewEvents)).toHaveLength(0);
    expect(await db.select().from(cards)).toHaveLength(0);
    expect(await db.select().from(sessionDays)).toHaveLength(0);
    const [after] = await db.select().from(topics).where(eq(topics.id, topic.id));
    expect(after?.diagnosticState).toBeNull();
  });

  it('scope=topics puts the learner back at onboarding', async () => {
    const { user } = await learnerWithProgress();

    const res = await request(app).post('/dev/reset').set('Cookie', user.cookie).send({ scope: 'topics' });

    expect(res.status).toBe(200);
    expect(await db.select().from(topics)).toHaveLength(0);
    expect(await db.select().from(concepts)).toHaveLength(0);
    expect(await db.select().from(items)).toHaveLength(0);
  });

  it('never touches another learner', async () => {
    const mine = await learnerWithProgress();
    const theirs = await learnerWithProgress();

    await request(app).post('/dev/reset').set('Cookie', mine.user.cookie).send({ scope: 'topics' });

    // Even in development, a reset is scoped to the caller.
    expect(await db.select().from(topics).where(eq(topics.userId, theirs.user.id))).toHaveLength(1);
    expect(
      await db.select().from(cards).where(eq(cards.userId, theirs.user.id)),
    ).toHaveLength(1);
  });

  it('requires a session and a valid scope', async () => {
    const { user } = await learnerWithProgress();
    expect((await request(app).post('/dev/reset').send({ scope: 'topics' })).status).toBe(401);
    expect(
      (await request(app).post('/dev/reset').set('Cookie', user.cookie).send({ scope: 'everything' })).status,
    ).toBe(400);
  });

  it('does not exist under NODE_ENV=production', async () => {
    const { user } = await learnerWithProgress();

    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const { createApp: createProdApp } = await import('../../app.js');

    const res = await request(createProdApp())
      .post('/dev/reset')
      .set('Cookie', user.cookie)
      .send({ scope: 'topics' });

    expect(res.status).toBe(404);
    expect(await db.select().from(topics)).toHaveLength(1);

    vi.unstubAllEnvs();
    vi.resetModules();
  });
});

describe('POST /auth/logout', () => {
  it('ends the session and clears the cookie', async () => {
    const user = await seedUser();
    expect((await request(app).get('/me').set('Cookie', user.cookie)).status).toBe(200);

    const res = await request(app).post('/auth/logout').set('Cookie', user.cookie);

    expect(res.status).toBe(200);
    expect(String(res.headers['set-cookie'])).toContain('learnos_session=;');
    // The cookie is gone from the browser, and the session is dead server-side
    // too — a copied cookie value must not keep working.
    expect((await request(app).get('/me').set('Cookie', user.cookie)).status).toBe(401);
  });

  it('leaves the extension connected', async () => {
    const user = await seedUser();
    const extension = await request(app).post('/auth/extension-token').set('Cookie', user.cookie);
    expect(extension.status).toBe(201);

    await request(app).post('/auth/logout').set('Cookie', user.cookie);

    // Signing out of a browser must not silently disconnect a device that
    // holds its own token by design.
    const res = await request(app).get('/me').set('Authorization', `Bearer ${extension.body.token}`);
    expect(res.status).toBe(200);
  });

  it('succeeds with no session at all', async () => {
    // The caller wants to end up signed out; a 401 would leave a stale cookie
    // with nothing the UI could do about it.
    expect((await request(app).post('/auth/logout')).status).toBe(200);
  });
});
