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
    crux: [],
    // The full map shape, because this mock replaces `generateConceptMap`
    // and therefore its validation too: the worker reads `misconceptions`,
    // `hardBecause` (which decides the teach mode) and `domain` (which batches
    // the item calls) straight off these rows.
    concepts: Array.from({ length: 10 }, (_, index) => ({
      slug: `concept-${index + 1}`,
      title: `Concept ${index + 1}`,
      summary: `Summary ${index + 1}`,
      prereqs: [],
      serves: ['cap'],
      misconceptions: [`Concept ${index + 1} is the same as the one before it.`],
      hardBecause: index % 2 === 0 ? 'counterintuitive' : 'no-prior-hook',
      domain: 'prose',
    })),
  })),
}));

vi.mock('../generator/framing.js', () => ({
  generateFraming: vi.fn(async () => ({
    topic: 'Topic',
    level: 'working',
    capabilities: [{ id: 'cap', statement: 'Do the thing.', evidence: 'Does it.' }],
    centralMisconception: 'The obvious reading is right.',
    spine: { name: 'one running example', description: 'one system', whyItFits: 'serves cap' },
    assumedKnowledge: ['a', 'b'],
    outOfScope: ['x', 'y'],
  })),
  formatSpine: (spine: { name: string }) => spine.name,
}));

vi.mock('../generator/items.js', async () => ({
  // Spread first: `itemBlocks.ts` reads MAX_RICH_ITEMS and itemVariants from
  // this module at import time, so a mock listing only the function fails
  // at load rather than at the call it meant to fake.
  ...(await vi.importActual<typeof import('../generator/items.js')>('../generator/items.js')),
  generateItemsBatch: vi.fn(async ({ topic, concepts }: { topic: string; concepts: { slug: string; title: string }[] }) => ({
    topic,
    bySlug: new Map(
      concepts.map(({ slug, title }) => [
        slug,
        [
          { payload: { type: 'recall', prompt: `${title}: recall`, answer: 'the answer', accept: [] }, isTransfer: false },
          { payload: { type: 'recognition', prompt: `${title}: recognition`, options: ['a', 'b', 'c', 'd'], answerIndex: 1, distractorSource: 'the adjacent idea' }, isTransfer: false },
          { payload: { type: 'application', prompt: `${title}: application`, answer: 'the answer', accept: [] }, isTransfer: false },
          { payload: { type: 'explain', prompt: `${title}: explain`, rubric: 'Mentions the answer.' }, isTransfer: false },
          { payload: { type: 'recall', prompt: `${title}: transfer`, answer: 'the answer', accept: [] }, isTransfer: true },
          { payload: { type: 'recall', prompt: `${title}: extra`, answer: 'the answer', accept: [] }, isTransfer: false },
        ],
      ]),
    ),
  })),
}));

vi.mock('../generator/teaching.js', () => ({
  generateTeaching: vi.fn(async ({ concept }: { concept: string }) => ({
    tryFirstPrompt: `What do you think ${concept} does?`,
    explanationShort: `${concept} in brief.`,
    explanationLong: `${concept} at greater length, with more detail than the short form.`,
    corrections: [{ wrong: 'a misconception', why: 'because' }, { wrong: 'another', why: 'also because' }],
  })),
}));

// T-FIX-013. The enrichment pass (T-166) is a real model call; without this the
// generation below runs it, and the SDK retries the fetch guard's refusal with
// backoff on every concept.
vi.mock('../generator/itemBlocks.js', async () => ({
  ...(await vi.importActual<typeof import('../generator/itemBlocks.js')>('../generator/itemBlocks.js')),
  enrichConceptItems: async (input: { items: unknown[] }) => ({ items: input.items }),
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