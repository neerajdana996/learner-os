import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { QueueEvents } from 'bullmq';
import { env } from '../../lib/env.js';
import { and, eq } from 'drizzle-orm';
import { TestNextSchema, TestSubmitSchema } from '@learnos/shared';
import { createApp } from '../../app.js';
import { db } from '../../db/client.js';
import { cards, items, reviewEvents, tests, topics } from '../../db/schema.js';
import { seedUser, truncateAll } from '../../test/db.js';
import { createTestWorker, TEST_QUEUE, processTestJob } from '../../workers/tests.worker.js';
import { closeTestQueue, getTestQueue } from '../../workers/tests.queue.js';
import { answerTestItem, completeTest, nextTestItem } from './tests.service.js';
import { testCandidates } from './tests.repository.js';
import { findCandidates } from '../due/due.repository.js';
import { POPUP_INELIGIBLE_KINDS } from '../../lib/popupEligible.js';
import { DAY, NOW, seedColdTopic } from './tests.fixtures.js';

const app = createApp();
beforeEach(async () => { await truncateAll(); await getTestQueue().obliterate({ force: true }); });
afterAll(closeTestQueue);

describe('persisted cold tests', () => {
  it('filters recent answers, retirement and exactly the same formats as the extension in SQL', async () => {
    const seed = await seedColdTopic();
    const conceptId = seed.concepts[0]!.id;
    const formats = [...POPUP_INELIGIBLE_KINDS, 'numeric', 'hotspotLine', 'clozeCode', 'graphBuild', 'future-format'];
    const rows = await db.insert(items).values(formats.map((kind) => ({ conceptId, type: 'recall' as const,
      payload: { type: 'recall', prompt: kind, answer: 'yes' }, answerKind: kind }))).returning();
    const testRows = await testCandidates(seed.user.id, seed.topic.id, NOW);
    const popupRows = await findCandidates([conceptId], true);
    for (const row of rows) expect(testRows.some((r) => r.id === row.id)).toBe(popupRows.some((r) => r.id === row.id));
    const recent = seed.items[0]!, boundary = seed.items[1]!, old = seed.items[2]!, dismissed = seed.items[3]!;
    await db.insert(reviewEvents).values([
      { userId: seed.user.id, conceptId, itemId: recent.id, correct: true, surface: 'web', predictedRecall: 0, createdAt: new Date(NOW.getTime() - DAY) },
      { userId: seed.user.id, conceptId, itemId: boundary.id, correct: false, surface: 'test', predictedRecall: 0, createdAt: new Date(NOW.getTime() - 7 * DAY) },
      { userId: seed.user.id, conceptId, itemId: old.id, correct: false, surface: 'diagnostic', predictedRecall: 0, createdAt: new Date(NOW.getTime() - 7 * DAY - 1) },
      { userId: seed.user.id, conceptId, itemId: dismissed.id, correct: null, surface: 'extension', predictedRecall: 0, createdAt: NOW },
    ]);
    await db.update(items).set({ flaggedBad: 3 }).where(eq(items.id, seed.items[5]!.id));
    const eligible = await testCandidates(seed.user.id, seed.topic.id, NOW);
    expect(eligible.map((i) => i.id)).not.toEqual(expect.arrayContaining([recent.id, boundary.id]));
    expect(eligible.some((i) => i.id === recent.id || i.id === boundary.id || i.id === seed.items[5]!.id)).toBe(false);
    expect(eligible.map((i) => i.id)).toEqual(expect.arrayContaining([old.id, dismissed.id]));
    const built = await processTestJob({ userId: seed.user.id, topicId: seed.topic.id }, NOW);
    const [test] = await db.select().from(tests).where(eq(tests.id, built.testId));
    expect(test!.itemIds).not.toContain(recent.id);
    expect(test!.itemIds).not.toContain(boundary.id);
  });
  it('serialises concurrent generation, retries answers, resumes and completes without changing a card', async () => {
    const seed = await seedColdTopic();
    const before = await db.select().from(cards);
    const builds = await Promise.all([1, 2].map(() => processTestJob({ userId: seed.user.id, topicId: seed.topic.id }, NOW)));
    const id = builds[0]!.testId;
    expect(builds[1]!.testId).toBe(id);
    expect(await db.select().from(tests)).toHaveLength(1);
    const first = await nextTestItem(seed.user.id, id);
    expect(TestNextSchema.safeParse(first).success).toBe(true);
    expect(JSON.stringify(first)).not.toMatch(/"answer"|"rubric"|"answerIndex"/);
    await expect(completeTest(seed.user.id, id)).rejects.toThrow('test_incomplete');
    const answer = { itemId: first.item!.itemId, response: 'yes', confidence: 'sure' as const, latencyMs: 1200 };
    await Promise.all([1, 2].map(() => answerTestItem(seed.user.id, id, answer, NOW)));
    expect(await db.select().from(reviewEvents)).toHaveLength(1);
    let next = await nextTestItem(seed.user.id, id);
    expect(next.progress.answered).toBe(1);
    while (next.item) next = await answerTestItem(seed.user.id, id,
      { itemId: next.item.itemId, response: 'yes', confidence: 'sure', latencyMs: 1000 }, NOW);
    expect(next.done).toBe(true);
    expect(next.scores).toBeUndefined();
    const scores = await completeTest(seed.user.id, id);
    expect(scores).toMatchObject({ overall: 1, taught: 1, heldOut: 1, transfer: 1, calibrationGap: 0 });
    expect(await completeTest(seed.user.id, id)).toEqual(scores);
    await answerTestItem(seed.user.id, id, { ...answer, response: 'wrong', confidence: 'guess' }, NOW);
    expect(await db.select().from(cards)).toEqual(before);
    const events = await db.select().from(reviewEvents);
    expect(events).toHaveLength(25);
    expect(events.every((e) => e.surface === 'test' && e.cardId === null && e.predictedRecall !== null)).toBe(true);
    expect(events.filter((e) => seed.concepts.some((c) => c.id === e.conceptId && c.heldOut)).every((e) => e.gapDaysSinceLast === null)).toBe(true);
    expect((await db.select().from(topics).where(eq(topics.id, seed.topic.id)))[0]!.status).toBe('done');
  });
  it('requires authentication, valid params, a due date, ownership, confidence and membership', async () => {
    const seed = await seedColdTopic(new Date(Date.now() - DAY));
    const other = await seedUser();
    const { testId } = await processTestJob({ userId: seed.user.id, topicId: seed.topic.id });
    expect((await request(app).get(`/tests/${testId}/next`)).status).toBe(401);
    expect((await request(app).get('/tests/invalid/next').set('Cookie', seed.user.cookie)).status).toBe(400);
    for (const path of ['next', 'complete', 'answer']) {
      const req = path === 'next' ? request(app).get(`/tests/${testId}/${path}`) : request(app).post(`/tests/${testId}/${path}`);
      const res = await req.set('Cookie', other.cookie).send(path === 'answer' ? { itemId: seed.items[0]!.id, response: 'yes', confidence: 'sure', latencyMs: 1 } : {});
      expect(res.status).toBe(404);
    }
    const first = await nextTestItem(seed.user.id, testId);
    expect((await request(app).post(`/tests/${testId}/answer`).set('Cookie', seed.user.cookie)
      .send({ itemId: first.item!.itemId, response: 'yes', latencyMs: 1, confidence: null })).status).toBe(400);
    expect(TestSubmitSchema.safeParse({ itemId: first.item!.itemId, response: 'yes', latencyMs: 1 }).success).toBe(false);
    const unrelated = await seedColdTopic(new Date(Date.now() - DAY));
    expect((await request(app).post(`/tests/${testId}/answer`).set('Cookie', seed.user.cookie)
      .send({ itemId: unrelated.items[0]!.id, response: 'yes', latencyMs: 1, confidence: 'sure' })).status).toBe(400);
    expect((await request(app).post(`/topics/${seed.topic.id}/tests`).set('Cookie', seed.user.cookie).send({ kind: 'day45' })).status).toBe(400);
    await db.update(topics).set({ startsAt: new Date(), endsAt: new Date(Date.now() + 7 * DAY) }).where(eq(topics.id, unrelated.topic.id));
    expect((await request(app).post(`/topics/${unrelated.topic.id}/tests`).set('Cookie', unrelated.user.cookie).send({ kind: 'day30' })).status).toBe(409);
    expect(await db.select().from(reviewEvents)).toHaveLength(0);
  });
  it('queues the authenticated route once, builds through the real worker, and exposes the saved test', async () => {
    const seed = await seedColdTopic(new Date(Date.now() - DAY));
    const events = new QueueEvents(TEST_QUEUE, { connection: { url: env.REDIS_URL } });
    const worker = createTestWorker();
    try {
      await events.waitUntilReady();
      const created = await request(app).post(`/topics/${seed.topic.id}/tests`).set('Cookie', seed.user.cookie).send({ kind: 'day30' });
      expect(created.status).toBe(202);
      const job = await getTestQueue().getJob(created.body.jobId);
      await job!.waitUntilFinished(events, 10_000);
      const available = await request(app).get(`/topics/${seed.topic.id}/tests`).set('Cookie', seed.user.cookie);
      expect(available.body).toMatchObject({ state: 'ready' });
      const next = await request(app).get(`/tests/${available.body.testId}/next`).set('Cookie', seed.user.cookie);
      expect(next.status).toBe(200);
      expect(next.body.progress).toEqual({ answered: 0, total: 25 });
      const retried = await request(app).post(`/topics/${seed.topic.id}/tests`).set('Cookie', seed.user.cookie).send({ kind: 'day30' });
      expect(retried.body.testId).toBe(available.body.testId);
      expect(await getTestQueue().getJobs()).toHaveLength(1);
    } finally { await worker.close(); await events.close(); }
  });
  it('records a blank as incorrect, with a required confidence and no schedule', async () => {
    const seed = await seedColdTopic();
    const { testId } = await processTestJob({ userId: seed.user.id, topicId: seed.topic.id }, NOW);
    const first = await nextTestItem(seed.user.id, testId);
    await answerTestItem(seed.user.id, testId, { itemId: first.item!.itemId, response: null, confidence: 'guess', latencyMs: 5 }, NOW);
    const [event] = await db.select().from(reviewEvents);
    expect(event).toMatchObject({ correct: false, confidence: 'guess', cardId: null });
  });
  it('does not leak or replace a retired selected item, and refuses answers out of order', async () => {
    const seed = await seedColdTopic();
    const { testId } = await processTestJob({ userId: seed.user.id, topicId: seed.topic.id }, NOW);
    const [test] = await db.select().from(tests).where(eq(tests.id, testId));
    const ids = test!.itemIds as string[];
    await expect(answerTestItem(seed.user.id, testId, { itemId: ids[1]!, response: 'yes', confidence: 'sure', latencyMs: 1 }, NOW)).rejects.toThrow('answer_out_of_order');
    await db.update(items).set({ flaggedBad: 3 }).where(eq(items.id, ids[0]!));
    await expect(nextTestItem(seed.user.id, testId)).rejects.toThrow('test_item_retired');
    expect(await db.select().from(reviewEvents).where(and(eq(reviewEvents.userId, seed.user.id), eq(reviewEvents.surface, 'test')))).toHaveLength(0);
  });
});
