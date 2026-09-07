import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { createApp } from '../../app.js';
import { db } from '../../db/client.js';
import { cards, concepts, items, topics } from '../../db/schema.js';
import { seedUser, truncateAll } from '../../test/db.js';
import { countDue } from '../../lib/makeDue.js';

const app = createApp();
const DAY = 86_400_000;

let user: Awaited<ReturnType<typeof seedUser>>;
let topicId: string;

beforeEach(async () => {
  await truncateAll();
  user = await seedUser();
  const [topic] = await db
    .insert(topics)
    .values({ userId: user.id, title: 'T', status: 'active' })
    .returning({ id: topics.id });
  topicId = topic!.id;
});

async function seedCard(opts: { order: number; dueInDays: number; heldOut?: boolean; taught?: boolean }) {
  const [concept] = await db
    .insert(concepts)
    .values({
      topicId,
      slug: `c${opts.order}`,
      title: `Concept ${opts.order}`,
      order: opts.order,
      heldOut: opts.heldOut ?? false,
    })
    .returning({ id: concepts.id });

  await db.insert(items).values({
    conceptId: concept!.id,
    type: 'recall',
    payload: { type: 'recall', prompt: 'q', answer: 'a', accept: [] },
  });

  await db.insert(cards).values({
    userId: user.id,
    conceptId: concept!.id,
    due: new Date(Date.now() + opts.dueInDays * DAY),
    taughtAt: (opts.taught ?? true) ? new Date(Date.now() - 2 * DAY) : null,
    stability: 3,
    difficulty: 5,
    reps: 1,
    state: 2,
  });
  return concept!.id;
}

describe('POST /dev/due-now', () => {
  it('brings the queue forward so the extension has something to pop', async () => {
    // After a session FSRS schedules hours or days out — correct, and it makes
    // the extension impossible to try without editing the system clock.
    await seedCard({ order: 4, dueInDays: 3 });
    await seedCard({ order: 5, dueInDays: 5 });
    expect(await countDue(user.id)).toBe(0);

    const res = await request(app)
      .post('/dev/due-now')
      .set('Cookie', user.cookie)
      .send({ count: 5 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ due: 2 });
    expect(await countDue(user.id)).toBe(2);
  });

  it('serves them through /due, which is the point', async () => {
    await seedCard({ order: 4, dueInDays: 3 });

    await request(app).post('/dev/due-now').set('Cookie', user.cookie).send({ count: 5 });
    const due = await request(app).get('/due?limit=1').set('Cookie', user.cookie);

    expect(due.status).toBe(200);
    expect(due.body.items).toHaveLength(1);
  });

  it('takes the soonest first', async () => {
    // "Bring 1 forward" should take the card the learner would have met next,
    // not an arbitrary one.
    const soon = await seedCard({ order: 4, dueInDays: 1 });
    await seedCard({ order: 5, dueInDays: 9 });

    await request(app).post('/dev/due-now').set('Cookie', user.cookie).send({ count: 1 });

    const [moved] = await db
      .select({ due: cards.due })
      .from(cards)
      .where(and(eq(cards.userId, user.id), eq(cards.conceptId, soon)));
    expect(moved!.due.getTime()).toBeLessThanOrEqual(Date.now());
    expect(await countDue(user.id)).toBe(1);
  });

  it('never moves a card /due would refuse to serve', async () => {
    // A held-out or untaught card brought forward is a queue entry the due
    // query then silently drops — which looks exactly like this not working.
    await seedCard({ order: 4, dueInDays: 3, heldOut: true });
    await seedCard({ order: 5, dueInDays: 3, taught: false });

    const res = await request(app)
      .post('/dev/due-now')
      .set('Cookie', user.cookie)
      .send({ count: 5 });

    expect(res.body).toEqual({ due: 0 });
    expect(await countDue(user.id)).toBe(0);
  });

  it('leaves another learner alone', async () => {
    await seedCard({ order: 4, dueInDays: 3 });
    const stranger = await seedUser();

    await request(app).post('/dev/due-now').set('Cookie', stranger.cookie).send({ count: 5 });

    expect(await countDue(user.id)).toBe(0);
  });

  it('keeps the scheduling history intact', async () => {
    // Only `due` moves: stability, reps and taughtAt stay, so the next real
    // review still schedules from the learner's actual history.
    const conceptId = await seedCard({ order: 4, dueInDays: 3 });

    await request(app).post('/dev/due-now').set('Cookie', user.cookie).send({ count: 5 });

    const [card] = await db
      .select()
      .from(cards)
      .where(and(eq(cards.userId, user.id), eq(cards.conceptId, conceptId)));
    expect(card!.stability).toBe(3);
    expect(card!.reps).toBe(1);
    expect(card!.taughtAt).not.toBeNull();
  });

  it('defaults to five without a body', async () => {
    for (const order of [4, 5, 6, 7, 8, 9]) await seedCard({ order, dueInDays: 3 });

    const res = await request(app).post('/dev/due-now').set('Cookie', user.cookie).send({});

    expect(res.body).toEqual({ due: 5 });
  });

  it('requires a user', async () => {
    expect((await request(app).post('/dev/due-now').send({ count: 1 })).status).toBe(401);
  });
});
