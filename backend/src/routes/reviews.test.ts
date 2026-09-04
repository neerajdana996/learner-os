import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { createApp } from '../app.js';
import { db } from '../db/client.js';
import { cards, concepts, items, reviewEvents, topics } from '../db/schema.js';
import { recordReview } from '../lib/recordReview.js';
import { seedUser, truncateAll } from '../test/db.js';

const app = createApp();

const DAY = 86_400_000;
const t0 = new Date('2026-01-01T09:00:00.000Z');

/** A user with one topic, one concept and one item to answer. */
async function seedItem() {
  const user = await seedUser();
  const [topic] = await db.insert(topics).values({ userId: user.id, title: 'T' }).returning({ id: topics.id });
  if (!topic) throw new Error('no topic');
  const [concept] = await db
    .insert(concepts)
    .values({ topicId: topic.id, slug: 'c1', title: 'C1', order: 1 })
    .returning({ id: concepts.id });
  if (!concept) throw new Error('no concept');
  const [item] = await db
    .insert(items)
    .values({ conceptId: concept.id, type: 'recall', payload: { type: 'recall', prompt: 'Q', answer: 'A' } })
    .returning({ id: items.id });
  if (!item) throw new Error('no item');
  return { user, concept, item };
}

const answer = (itemId: string, over: Partial<Record<string, unknown>> = {}) => ({
  itemId,
  correct: true,
  confidence: 'sure' as const,
  surface: 'web' as const,
  ...over,
});

beforeEach(async () => {
  await truncateAll();
});

describe('recordReview', () => {
  it('first correct answer: reps=1, gap null, predictedRecall 0', async () => {
    const { user, concept, item } = await seedItem();

    const result = await recordReview(user.id, answer(item.id) as never, t0);

    expect(result.predictedRecall).toBe(0);
    expect(result.gapDaysSinceLast).toBeNull();
    expect(result.scheduled).toBe(true);
    expect(result.reps).toBe(1);

    const [card] = await db
      .select()
      .from(cards)
      .where(and(eq(cards.userId, user.id), eq(cards.conceptId, concept.id)));
    expect(card?.reps).toBe(1);

    const [event] = await db.select().from(reviewEvents).where(eq(reviewEvents.userId, user.id));
    expect(event?.gapDaysSinceLast).toBeNull();
    expect(event?.predictedRecall).toBe(0);
    expect(event?.cardId).toBe(card?.id);
  });

  it('second answer 3 days later: gap 3, predictedRecall in (0,1)', async () => {
    const { user, item } = await seedItem();
    await recordReview(user.id, answer(item.id) as never, t0);

    const later = new Date(t0.getTime() + 3 * DAY);
    const result = await recordReview(user.id, answer(item.id) as never, later);

    expect(result.gapDaysSinceLast).toBe(3);
    expect(result.predictedRecall).toBeGreaterThan(0);
    expect(result.predictedRecall).toBeLessThan(1);
    expect(result.reps).toBe(2);
  });

  it('correct=null with dismissed=true writes the event and leaves the card alone', async () => {
    const { user, concept, item } = await seedItem();
    await recordReview(user.id, answer(item.id) as never, t0);
    const [before] = await db
      .select()
      .from(cards)
      .where(and(eq(cards.userId, user.id), eq(cards.conceptId, concept.id)));

    const result = await recordReview(
      user.id,
      answer(item.id, { correct: null, dismissed: true, confidence: null }) as never,
      new Date(t0.getTime() + DAY),
    );

    expect(result.scheduled).toBe(false);
    const events = await db.select().from(reviewEvents).where(eq(reviewEvents.userId, user.id));
    expect(events).toHaveLength(2);
    expect(events.some((e) => e.dismissed)).toBe(true);

    const [after] = await db
      .select()
      .from(cards)
      .where(and(eq(cards.userId, user.id), eq(cards.conceptId, concept.id)));
    expect(after?.reps).toBe(before?.reps);
    expect(after?.due.getTime()).toBe(before?.due.getTime());
  });

  it('snoozed answer records snoozed=true and leaves the card alone', async () => {
    const { user, concept, item } = await seedItem();
    await recordReview(user.id, answer(item.id) as never, t0);
    const [before] = await db
      .select()
      .from(cards)
      .where(and(eq(cards.userId, user.id), eq(cards.conceptId, concept.id)));

    const result = await recordReview(
      user.id,
      answer(item.id, { correct: null, snoozed: true, confidence: null }) as never,
      new Date(t0.getTime() + DAY),
    );

    expect(result.scheduled).toBe(false);
    const snoozedEvents = await db
      .select()
      .from(reviewEvents)
      .where(and(eq(reviewEvents.userId, user.id), eq(reviewEvents.snoozed, true)));
    expect(snoozedEvents).toHaveLength(1);

    const [after] = await db
      .select()
      .from(cards)
      .where(and(eq(cards.userId, user.id), eq(cards.conceptId, concept.id)));
    expect(after?.reps).toBe(before?.reps);
  });

  it('the same idempotencyKey twice writes one event and returns the same body', async () => {
    const { user, item } = await seedItem();
    const key = randomUUID();

    const first = await recordReview(user.id, answer(item.id, { idempotencyKey: key }) as never, t0);
    const second = await recordReview(
      user.id,
      answer(item.id, { idempotencyKey: key }) as never,
      new Date(t0.getTime() + DAY),
    );

    expect(second.eventId).toBe(first.eventId);
    expect(second.predictedRecall).toBe(first.predictedRecall);
    expect(second.gapDaysSinceLast).toBe(first.gapDaysSinceLast);

    expect(await db.select().from(reviewEvents).where(eq(reviewEvents.userId, user.id))).toHaveLength(1);
    // The retry must not have scheduled a second time.
    const [card] = await db.select().from(cards).where(eq(cards.userId, user.id));
    expect(card?.reps).toBe(1);
  });

  it('a diagnostic answer is recorded but never schedules the card', async () => {
    const { user, item } = await seedItem();

    const result = await recordReview(user.id, answer(item.id, { surface: 'diagnostic' }) as never, t0);

    expect(result.scheduled).toBe(false);
    expect(await db.select().from(cards).where(eq(cards.userId, user.id))).toHaveLength(0);
    const [event] = await db.select().from(reviewEvents).where(eq(reviewEvents.userId, user.id));
    expect(event?.surface).toBe('diagnostic');
    expect(event?.predictedRecall).toBe(0);
  });

  it('one user\'s idempotency key never returns another user\'s event', async () => {
    const { user, item } = await seedItem();
    const other = await seedUser();
    const key = randomUUID();

    const mine = await recordReview(user.id, answer(item.id, { idempotencyKey: key }) as never, t0);
    const theirs = await recordReview(other.id, answer(item.id, { idempotencyKey: key }) as never, t0);

    // Two distinct events, one per user — the key namespace is per user, so the
    // second call must record its own answer rather than replay the first.
    expect(theirs.eventId).not.toBe(mine.eventId);
    expect(await db.select().from(reviewEvents).where(eq(reviewEvents.userId, user.id))).toHaveLength(1);
    expect(await db.select().from(reviewEvents).where(eq(reviewEvents.userId, other.id))).toHaveLength(1);
  });
});

describe('POST /reviews', () => {
  it('records an answer and returns 200', async () => {
    const { user, item } = await seedItem();

    const res = await request(app).post('/reviews').set('x-user-id', user.id).send(answer(item.id));

    expect(res.status).toBe(200);
    expect(res.body.scheduled).toBe(true);
    expect(res.body.predictedRecall).toBe(0);
    expect(res.body.gapDaysSinceLast).toBeNull();
  });

  it('rejects an invalid confidence with 400', async () => {
    const { user, item } = await seedItem();
    const res = await request(app)
      .post('/reviews')
      .set('x-user-id', user.id)
      .send(answer(item.id, { confidence: 'positive' }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation');
  });

  it('404s for an unknown item', async () => {
    const user = await seedUser();
    const res = await request(app).post('/reviews').set('x-user-id', user.id).send(answer(randomUUID()));

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('item_not_found');
  });

  it('requires a user', async () => {
    const { item } = await seedItem();
    const res = await request(app).post('/reviews').send(answer(item.id));
    expect(res.status).toBe(401);
  });
});
