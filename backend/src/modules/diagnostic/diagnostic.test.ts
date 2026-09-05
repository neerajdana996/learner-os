import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { createApp } from '../../app.js';
import { db } from '../../db/client.js';
import { cards, conceptPrereqs, concepts, items, reviewEvents, tests, topics, users } from '../../db/schema.js';
import { seedUser, truncateAll } from '../../test/db.js';
import { KNOWN_THRESHOLD, MAX_QUESTIONS } from '../../lib/diagnostic.js';

const app = createApp();

const ANSWER = 'the answer';

/**
 * A chain of `n` concepts, each depending on the one before, every concept
 * carrying one recall item whose answer is known to the test.
 */
async function seedTopic(n: number, heldOutOrders: number[] = []) {
  const user = await seedUser();
  const [topic] = await db
    .insert(topics)
    .values({ userId: user.id, title: 'React Hooks', status: 'active' })
    .returning({ id: topics.id });
  if (!topic) throw new Error('topic insert returned no row');

  const rows = await db
    .insert(concepts)
    .values(
      Array.from({ length: n }, (_, i) => ({
        topicId: topic.id,
        slug: `c${i + 1}`,
        title: `Concept ${i + 1}`,
        order: i + 1,
        heldOut: heldOutOrders.includes(i + 1),
        teachMode: 'try_first' as const,
      })),
    )
    .returning({ id: concepts.id, order: concepts.order, heldOut: concepts.heldOut });

  const byOrder = new Map(rows.map((r) => [r.order, r.id]));
  const edges = Array.from({ length: n - 1 }, (_, i) => ({
    conceptId: byOrder.get(i + 2) as string,
    prerequisiteConceptId: byOrder.get(i + 1) as string,
  }));
  if (edges.length > 0) await db.insert(conceptPrereqs).values(edges);

  await db.insert(items).values(
    rows.map((r) => ({
      conceptId: r.id,
      type: 'recall' as const,
      payload: { type: 'recall', prompt: 'q', answer: ANSWER, accept: [] },
      isTransfer: false,
    })),
  );

  return { user, topicId: topic.id, conceptRows: rows };
}

/** Drives the diagnostic to completion, answering per `correct`. */
async function runDiagnostic(cookie: string, topicId: string, correct: (index: number) => boolean) {
  let res = await request(app).post(`/diagnostic/${topicId}/start`).set('Cookie', cookie);
  const asked: string[] = [];
  let index = 0;

  while (res.body.done === false) {
    asked.push(res.body.conceptId);
    res = await request(app)
      .post(`/diagnostic/${topicId}/answer`)
      .set('Cookie', cookie)
      .send({
        conceptId: res.body.conceptId,
        itemId: res.body.item.itemId,
        response: correct(index) ? ANSWER : 'nonsense',
        confidence: 'sure',
        latencyMs: 1200,
      });
    index += 1;
    if (index > 60) throw new Error('diagnostic did not terminate');
  }
  return { final: res, asked };
}

beforeEach(async () => {
  await truncateAll();
});

describe('diagnostic', () => {
  it('stops early, marks known concepts taught, and creates cards when all answers are correct', async () => {
    const { user, topicId } = await seedTopic(12);
    const { final, asked } = await runDiagnostic(user.cookie, topicId, () => true);

    expect(final.body.done).toBe(true);
    expect(asked.length).toBeLessThan(MAX_QUESTIONS);

    const cardRows = await db.select().from(cards).where(eq(cards.userId, user.id));
    expect(cardRows).toHaveLength(12);
    // Everything answered correctly is "known", so the planner skips teaching it.
    expect(cardRows.every((c) => c.taughtAt !== null)).toBe(true);

    const [topic] = await db.select().from(topics).where(eq(topics.id, topicId));
    const estimates = (topic?.diagnosticState as { estimates: Record<string, number> }).estimates;
    for (const id of asked) expect(estimates[id]).toBeGreaterThanOrEqual(KNOWN_THRESHOLD);
  });

  it('teaches everything and sets no taughtAt when all answers are wrong', async () => {
    const { user, topicId } = await seedTopic(12);
    await runDiagnostic(user.cookie, topicId, () => false);

    const cardRows = await db.select().from(cards).where(eq(cards.userId, user.id));
    expect(cardRows).toHaveLength(12);
    expect(cardRows.every((c) => c.taughtAt === null)).toBe(true);
  });

  it('never asks about a held-out concept, and creates no card for one', async () => {
    const { user, topicId, conceptRows } = await seedTopic(12, [5, 9]);
    const heldIds = new Set(conceptRows.filter((r) => r.heldOut).map((r) => r.id));

    const { asked } = await runDiagnostic(user.cookie, topicId, () => true);

    for (const id of asked) expect(heldIds.has(id)).toBe(false);

    const cardRows = await db.select().from(cards).where(eq(cards.userId, user.id));
    expect(cardRows).toHaveLength(10);
    expect(cardRows.some((c) => heldIds.has(c.conceptId))).toBe(false);
  });

  it('caps at 15 questions on a 40-concept map with alternating answers', async () => {
    const { user, topicId } = await seedTopic(40);
    const { asked } = await runDiagnostic(user.cookie, topicId, (i) => i % 2 === 0);
    expect(asked).toHaveLength(MAX_QUESTIONS);
  });

  it('records answers with surface=diagnostic and schedules no card', async () => {
    const { user, topicId } = await seedTopic(5);

    const start = await request(app).post(`/diagnostic/${topicId}/start`).set('Cookie', user.cookie);
    await request(app)
      .post(`/diagnostic/${topicId}/answer`)
      .set('Cookie', user.cookie)
      .send({
        conceptId: start.body.conceptId,
        itemId: start.body.item.itemId,
        response: ANSWER,
        confidence: 'sure',
        latencyMs: 900,
      });

    const events = await db.select().from(reviewEvents).where(eq(reviewEvents.userId, user.id));
    expect(events).toHaveLength(1);
    expect(events[0]?.surface).toBe('diagnostic');
    // Scheduling here would contaminate the measurement the diagnostic exists
    // to take, so no card is touched mid-walk.
    expect(events[0]?.cardId).toBeNull();
    expect(await db.select().from(cards).where(eq(cards.userId, user.id))).toHaveLength(0);
  });

  it('writes a day0 test row with an overall score and a calibration gap', async () => {
    const { user, topicId } = await seedTopic(8);
    await runDiagnostic(user.cookie, topicId, (i) => i % 2 === 0);

    const [row] = await db
      .select()
      .from(tests)
      .where(and(eq(tests.userId, user.id), eq(tests.kind, 'day0')));

    const scores = row?.scores as { overall: number; calibrationGap: number | null };
    expect(scores.overall).toBeGreaterThanOrEqual(0);
    expect(scores.overall).toBeLessThanOrEqual(1);
    expect(typeof scores.calibrationGap).toBe('number');
  });

  it('writes the calibration gap onto the user profile', async () => {
    const { user, topicId } = await seedTopic(6);
    await runDiagnostic(user.cookie, topicId, () => true);

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    const profile = row?.profile as { calibrationGap: number | null };
    // Always "sure" and always right — a perfectly calibrated learner.
    expect(profile.calibrationGap).toBeCloseTo(0);
  });

  it('reports the sure-but-wrong count in the summary', async () => {
    const { user, topicId } = await seedTopic(8);
    const { final } = await runDiagnostic(user.cookie, topicId, (i) => i % 2 === 0);

    const { asked, sureCount, sureCorrectCount } = final.body.summary;
    expect(sureCount).toBe(asked);
    expect(sureCorrectCount).toBeLessThan(sureCount);
  });

  it('grades server-side — a wrong response cannot be claimed correct', async () => {
    const { user, topicId } = await seedTopic(5);
    const start = await request(app).post(`/diagnostic/${topicId}/start`).set('Cookie', user.cookie);

    await request(app)
      .post(`/diagnostic/${topicId}/answer`)
      .set('Cookie', user.cookie)
      .send({
        conceptId: start.body.conceptId,
        itemId: start.body.item.itemId,
        response: 'definitely not the answer',
        confidence: 'sure',
        latencyMs: 100,
      });

    const events = await db.select().from(reviewEvents).where(eq(reviewEvents.userId, user.id));
    expect(events[0]?.correct).toBe(false);
  });

  it('never leaks an answer key in the question payload', async () => {
    const { user, topicId } = await seedTopic(5);
    const res = await request(app).post(`/diagnostic/${topicId}/start`).set('Cookie', user.cookie);

    expect(JSON.stringify(res.body)).not.toContain(ANSWER);
    expect(res.body.item).not.toHaveProperty('answer');
    expect(res.body.item).not.toHaveProperty('accept');
  });

  it('returns 404 for another user’s topic', async () => {
    const { topicId } = await seedTopic(5);
    const other = await seedUser();

    const res = await request(app).get(`/diagnostic/${topicId}/next`).set('Cookie', other.cookie);
    expect(res.status).toBe(404);
  });

  it('requires authentication', async () => {
    const { topicId } = await seedTopic(3);
    expect((await request(app).get(`/diagnostic/${topicId}/next`)).status).toBe(401);
  });
});
