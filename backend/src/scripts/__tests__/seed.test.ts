import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { and, eq, lte } from 'drizzle-orm';
import { createApp } from '../../app.js';
import { db } from '../../db/client.js';
import { cards, concepts, topics, users } from '../../db/schema.js';
import { truncateAll } from '../../test/db.js';
import { isLocalDatabase, seed } from '../seed.js';

const app = createApp();

beforeEach(async () => {
  await truncateAll();
});

describe('isLocalDatabase', () => {
  it('accepts the hosts a developer actually uses', () => {
    for (const host of ['localhost', '127.0.0.1', 'postgres']) {
      expect(isLocalDatabase(`postgres://u:p@${host}:5432/learnos`)).toBe(true);
    }
  });

  it('refuses anything else, because seeding deletes rows', () => {
    expect(isLocalDatabase('postgres://u:p@db.production.example.com:5432/learnos')).toBe(false);
    expect(isLocalDatabase('postgres://u:p@10.0.0.5:5432/learnos')).toBe(false);
  });
});

describe('seed', () => {
  it('produces a topic that is ready to work on', async () => {
    const result = await seed();

    const [topic] = await db.select().from(topics).where(eq(topics.id, result.topicId));
    expect(topic?.status).toBe('active');
    expect(result.concepts).toBeGreaterThan(0);
    expect(result.items).toBeGreaterThan(0);
    expect(result.heldOut).toBeGreaterThan(0);
  });

  it('leaves due work so /due is not empty on a fresh checkout', async () => {
    const result = await seed();

    const res = await request(app).get('/due?limit=10').set('x-user-id', result.userId);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(2);
  });

  it('staggers the queue instead of dropping everything on today', async () => {
    const result = await seed();
    const rows = await db.select().from(cards).where(eq(cards.userId, result.userId));

    const now = Date.now();
    expect(rows.some((c) => c.due.getTime() <= now)).toBe(true);
    expect(rows.some((c) => c.due.getTime() > now)).toBe(true);
  });

  it('gives taught cards real review history, not blank ones', async () => {
    const result = await seed();
    const rows = await db.select().from(cards).where(eq(cards.userId, result.userId));

    // A blank card has stability 0, so predictedRecall is 0 and the map renders
    // a score of 0 with everything flagged at risk — useless to develop against.
    expect(rows.every((c) => c.stability > 0)).toBe(true);
    expect(rows.every((c) => c.reps > 0)).toBe(true);
  });

  it('produces a non-zero score on the map', async () => {
    const result = await seed();
    const res = await request(app)
      .get(`/topics/${result.topicId}/map`)
      .set('x-user-id', result.userId);

    expect(res.body.score).toBeGreaterThan(0);
  });

  it('never gives a held-out concept teaching content', async () => {
    const result = await seed();
    const held = await db
      .select()
      .from(concepts)
      .where(and(eq(concepts.topicId, result.topicId), eq(concepts.heldOut, true)));

    expect(held.length).toBeGreaterThan(0);
    for (const concept of held) {
      expect(concept.explanationShort).toBeNull();
      expect(concept.corrections).toEqual([]);
    }
  });

  it('is idempotent — developers run it repeatedly', async () => {
    const first = await seed();
    const second = await seed();

    expect(await db.select().from(users)).toHaveLength(1);
    expect(await db.select().from(topics)).toHaveLength(1);
    expect(second.concepts).toBe(first.concepts);
    // Cards from the first run must not linger against deleted concepts.
    const orphans = await db
      .select()
      .from(cards)
      .where(lte(cards.reps, 0));
    expect(orphans).toHaveLength(0);
  });
});
