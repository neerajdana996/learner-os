import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { createApp } from '../app.js';
import { db } from '../db/client.js';
import { cards, concepts, items, topics } from '../db/schema.js';
import { processGenerationJob } from '../workers/generator.worker.js';
import { seedUser, truncateAll } from '../test/db.js';
import { closeGenerationQueue, getGenerationQueue } from '../workers/queue.js';

vi.mock('../generator/conceptMap.js', () => ({
  generateConceptMap: vi.fn(async () => ({
    topic: 'React Hooks',
    concepts: Array.from({ length: 10 }, (_, index) => ({
      slug: `concept-${index + 1}`,
      title: `Concept ${index + 1}`,
      summary: `Summary ${index + 1}`,
      prereqs: [],
    })),
  })),
}));

vi.mock('../generator/items.js', () => ({
  generateItems: vi.fn(async (concept: string) => ({
    topic: concept,
    items: [
      { payload: { type: 'recall', prompt: `${concept} recall`, answer: 'the answer', accept: [] }, isTransfer: false },
      { payload: { type: 'recognition', prompt: `${concept} recognition`, options: ['a', 'b', 'c', 'd'], answerIndex: 0 }, isTransfer: false },
      { payload: { type: 'application', prompt: `${concept} application`, answer: 'the answer', accept: [] }, isTransfer: false },
      { payload: { type: 'explain', prompt: `${concept} explain`, rubric: 'Mention the answer.' }, isTransfer: false },
      { payload: { type: 'recall', prompt: `${concept} transfer`, answer: 'the answer', accept: [] }, isTransfer: true },
      { payload: { type: 'recall', prompt: `${concept} extra`, answer: 'the answer', accept: [] }, isTransfer: false },
    ],
  })),
}));

const app = createApp();
const validTopic = { title: 'React Hooks' };

beforeEach(async () => {
  await truncateAll();
  await getGenerationQueue().obliterate({ force: true });
});

afterAll(async () => {
  await closeGenerationQueue();
});

describe('Sprint 1 integration flow', () => {
  it('creates, generates, teaches, reviews, and advances a card', async () => {
    const user = await seedUser();
    const created = await request(app)
      .post('/topics')
      .set('Cookie', user.cookie)
      .send(validTopic);

    expect(created.status).toBe(202);
    await processGenerationJob({ topicId: created.body.topicId }, () => 0.99);

    const generated = await db
      .select({ id: concepts.id })
      .from(concepts)
      .innerJoin(topics, eq(concepts.topicId, topics.id))
      .where(eq(topics.id, created.body.topicId));
    expect(generated).toHaveLength(10);

    const taught = generated.slice(0, 2);
    await db.insert(cards).values(
      taught.map((concept) => ({
        userId: user.id,
        conceptId: concept.id,
        due: new Date(),
        taughtAt: new Date(),
      })),
    );

    const due = await request(app).get('/due?limit=2').set('Cookie', user.cookie);
    expect(due.status).toBe(200);
    expect(due.body.items).toHaveLength(2);

    const reviews = await Promise.all(
      due.body.items.map((item: { itemId: string }) =>
        request(app)
          .post('/reviews')
          .set('Cookie', user.cookie)
          .send({
            itemId: item.itemId,
            response: 'the answer',
            confidence: 'sure',
            surface: 'web',
          }),
      ),
    );
    expect(reviews.every((review) => review.status === 200)).toBe(true);
    expect(reviews.every((review) => review.body.correct === true)).toBe(true);

    const [reviewedCard] = await db
      .select({ due: cards.due })
      .from(cards)
      .where(and(eq(cards.userId, user.id), eq(cards.conceptId, reviews[0].body.conceptId)));
    expect(reviewedCard?.due.getTime()).toBeGreaterThan(Date.now());

    const afterReview = await request(app).get('/due?limit=2').set('Cookie', user.cookie);
    expect(afterReview.body.items).toEqual([]);
  });
});