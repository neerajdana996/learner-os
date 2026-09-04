import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../app.js';
import { db } from '../../db/client.js';
import { cards, concepts, items, reviewEvents, topics } from '../../db/schema.js';
import { seedUser, truncateAll } from '../../test/db.js';
import { toPublicItem } from '../../lib/publicItem.js';

const app = createApp();

const DAY = 86_400_000;
const past = (days: number) => new Date(Date.now() - days * DAY);
const future = (days: number) => new Date(Date.now() + days * DAY);

const recallPayload = (prompt: string) => ({
  type: 'recall' as const,
  prompt,
  answer: 'THE ANSWER',
  accept: ['also this'],
});

const recognitionPayload = {
  type: 'recognition' as const,
  prompt: 'Pick one',
  options: ['a', 'b', 'c', 'd'],
  answerIndex: 2,
};

const explainPayload = { type: 'explain' as const, prompt: 'Explain', rubric: 'SECRET RUBRIC' };

async function seedUserWithTopic(status: 'active' | 'holdout' | 'generating' = 'active') {
  const user = await seedUser();
  const [topic] = await db.insert(topics).values({ userId: user.id, title: 'T', status }).returning({ id: topics.id });
  if (!topic) throw new Error('no topic');
  return { user, topic };
}

/** A taught, due card on a non-held-out concept — the shape that should appear. */
async function seedDueConcept(
  userId: string,
  topicId: string,
  opts: {
    slug: string;
    order: number;
    heldOut?: boolean;
    taught?: boolean;
    due?: Date;
    payloads?: object[];
  },
) {
  const [concept] = await db
    .insert(concepts)
    .values({ topicId, slug: opts.slug, title: opts.slug, order: opts.order, heldOut: opts.heldOut ?? false })
    .returning({ id: concepts.id });
  if (!concept) throw new Error('no concept');

  const inserted = await db
    .insert(items)
    .values(
      (opts.payloads ?? [recallPayload('Q')]).map((payload) => ({
        conceptId: concept.id,
        type: (payload as { type: 'recall' }).type,
        payload,
      })),
    )
    .returning({ id: items.id });

  await db.insert(cards).values({
    userId,
    conceptId: concept.id,
    due: opts.due ?? past(1),
    taughtAt: (opts.taught ?? true) ? past(5) : null,
  });

  return { concept, itemIds: inserted.map((i) => i.id) };
}

const getDue = (userId: string, query = '') => request(app).get(`/due${query}`).set('x-user-id', userId);

beforeEach(async () => {
  await truncateAll();
});

describe('GET /due', () => {
  it('excludes a card that has not been taught', async () => {
    const { user, topic } = await seedUserWithTopic();
    await seedDueConcept(user.id, topic.id, { slug: 'a', order: 1, taught: false });

    const res = await getDue(user.id);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('excludes a held-out concept', async () => {
    const { user, topic } = await seedUserWithTopic();
    await seedDueConcept(user.id, topic.id, { slug: 'a', order: 4, heldOut: true });

    expect((await getDue(user.id)).body.items).toEqual([]);
  });

  it('excludes topics in holdout status', async () => {
    const { user, topic } = await seedUserWithTopic('holdout');
    await seedDueConcept(user.id, topic.id, { slug: 'a', order: 1 });

    expect((await getDue(user.id)).body.items).toEqual([]);
  });

  it('excludes cards that are not due yet', async () => {
    const { user, topic } = await seedUserWithTopic();
    await seedDueConcept(user.id, topic.id, { slug: 'a', order: 1, due: future(2) });

    expect((await getDue(user.id)).body.items).toEqual([]);
  });

  it('returns two due cards ordered by due ascending', async () => {
    const { user, topic } = await seedUserWithTopic();
    const older = await seedDueConcept(user.id, topic.id, { slug: 'older', order: 1, due: past(5) });
    const newer = await seedDueConcept(user.id, topic.id, { slug: 'newer', order: 2, due: past(1) });

    const res = await getDue(user.id);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items.map((i: { conceptId: string }) => i.conceptId)).toEqual([
      older.concept.id,
      newer.concept.id,
    ]);
  });

  it('respects ?limit=', async () => {
    const { user, topic } = await seedUserWithTopic();
    await seedDueConcept(user.id, topic.id, { slug: 'a', order: 1, due: past(5) });
    await seedDueConcept(user.id, topic.id, { slug: 'b', order: 2, due: past(4) });

    expect((await getDue(user.id, '?limit=1')).body.items).toHaveLength(1);
  });

  it('rejects a limit outside the allowed range', async () => {
    const { user } = await seedUserWithTopic();
    expect((await getDue(user.id, '?limit=0')).status).toBe(400);
    expect((await getDue(user.id, '?limit=999')).status).toBe(400);
  });

  it('avoids an item seen in the last 3 reviews when an alternative exists', async () => {
    const { user, topic } = await seedUserWithTopic();
    const { concept, itemIds } = await seedDueConcept(user.id, topic.id, {
      slug: 'a',
      order: 1,
      payloads: [recallPayload('seen'), recallPayload('unseen')],
    });
    const [seenId, unseenId] = itemIds;

    await db.insert(reviewEvents).values({
      userId: user.id,
      conceptId: concept.id,
      itemId: seenId,
      correct: true,
      surface: 'extension',
      predictedRecall: 0.5,
      gapDaysSinceLast: 1,
    });

    const res = await getDue(user.id);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].itemId).toBe(unseenId);
  });

  it('falls back to a recently seen item when every item has come up', async () => {
    const { user, topic } = await seedUserWithTopic();
    const { concept, itemIds } = await seedDueConcept(user.id, topic.id, { slug: 'a', order: 1 });
    const only = itemIds[0];

    await db.insert(reviewEvents).values({
      userId: user.id,
      conceptId: concept.id,
      itemId: only,
      correct: true,
      surface: 'extension',
      predictedRecall: 0.5,
      gapDaysSinceLast: 1,
    });

    const res = await getDue(user.id);
    expect(res.body.items[0].itemId).toBe(only);
  });

  it('never leaks answer, accept, answerIndex or rubric', async () => {
    const { user, topic } = await seedUserWithTopic();
    await seedDueConcept(user.id, topic.id, { slug: 'a', order: 1, due: past(5), payloads: [recallPayload('Q')] });
    await seedDueConcept(user.id, topic.id, { slug: 'b', order: 2, due: past(4), payloads: [recognitionPayload] });
    await seedDueConcept(user.id, topic.id, { slug: 'c', order: 3, due: past(3), payloads: [explainPayload] });

    const res = await getDue(user.id);
    expect(res.body.items).toHaveLength(3);

    // By key inspection, per the acceptance criterion...
    for (const item of res.body.items) {
      expect(Object.keys(item).sort()).toEqual(
        item.type === 'recognition'
          ? ['conceptId', 'itemId', 'options', 'prompt', 'type']
          : ['conceptId', 'itemId', 'prompt', 'type'],
      );
    }

    // ...and belt-and-braces on the serialised body, in case a value leaks
    // somewhere a key check wouldn't catch.
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('THE ANSWER');
    expect(raw).not.toContain('also this');
    expect(raw).not.toContain('SECRET RUBRIC');
    expect(raw).not.toContain('answerIndex');
  });

  it('only returns the calling user\'s cards', async () => {
    const { user, topic } = await seedUserWithTopic();
    await seedDueConcept(user.id, topic.id, { slug: 'a', order: 1 });
    const other = await seedUser();

    expect((await getDue(other.id)).body.items).toEqual([]);
  });

  it('requires a user', async () => {
    expect((await request(app).get('/due')).status).toBe(401);
  });
});

describe('toPublicItem', () => {
  const ids = { id: '11111111-1111-1111-1111-111111111111', conceptId: '22222222-2222-2222-2222-222222222222' };

  it.each([
    ['recall', recallPayload('Q'), ['conceptId', 'itemId', 'prompt', 'type']],
    ['application', { type: 'application', prompt: 'Apply', answer: 'X', accept: ['y'] }, ['conceptId', 'itemId', 'prompt', 'type']],
    ['explain', explainPayload, ['conceptId', 'itemId', 'prompt', 'type']],
    ['recognition', recognitionPayload, ['conceptId', 'itemId', 'options', 'prompt', 'type']],
  ])('strips the answer key from a %s item', (_type, payload, expectedKeys) => {
    const publicItem = toPublicItem({ ...ids, payload });
    expect(Object.keys(publicItem).sort()).toEqual(expectedKeys);
  });

  it('throws on a payload that does not match ItemPayload rather than serving it', () => {
    expect(() => toPublicItem({ ...ids, payload: { type: 'recall', prompt: 'Q' } })).toThrow();
  });
});
