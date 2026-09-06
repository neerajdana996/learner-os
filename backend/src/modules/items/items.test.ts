import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../app.js';
import { db } from '../../db/client.js';
import { cards, concepts, items, topics } from '../../db/schema.js';
import { seedUser, truncateAll } from '../../test/db.js';
import { RETIRED_FLAG_THRESHOLD } from '../../lib/retire.js';

const app = createApp();

async function seedItem() {
  const user = await seedUser();
  const [topic] = await db
    .insert(topics)
    .values({ userId: user.id, title: 'T', status: 'active' })
    .returning({ id: topics.id });
  const [concept] = await db
    .insert(concepts)
    .values({ topicId: topic!.id, slug: 'c', title: 'C', order: 1 })
    .returning({ id: concepts.id });
  const [item] = await db
    .insert(items)
    .values({
      conceptId: concept!.id,
      type: 'recall',
      payload: { type: 'recall', prompt: 'Q', answer: 'A' },
    })
    .returning({ id: items.id });

  await db.insert(cards).values({
    userId: user.id,
    conceptId: concept!.id,
    due: new Date(Date.now() - 86_400_000),
    taughtAt: new Date(Date.now() - 5 * 86_400_000),
  });

  return { user, item: item! };
}

const flag = (cookie: string, id: string) =>
  request(app).post(`/items/${id}/flag`).set('Cookie', cookie);

beforeEach(truncateAll);

describe('POST /items/:id/flag', () => {
  it('counts a report without retiring on the first one', async () => {
    const { user, item } = await seedItem();

    const res = await flag(user.cookie, item.id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ retired: false });
    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row?.flaggedBad).toBe(1);
  });

  /**
   * The threshold is shared with `pnpm qa:retire`, which sets the count straight
   * to it. A question the founder rejected in content QA and one three learners
   * reported are then excluded by exactly the same `flagged_bad < 3` predicate —
   * which is why retirement rode on this column rather than a new one.
   */
  it('retires on the third report', async () => {
    const { user, item } = await seedItem();

    for (let i = 1; i < RETIRED_FLAG_THRESHOLD; i += 1) {
      expect((await flag(user.cookie, item.id)).body).toEqual({ retired: false });
    }

    expect((await flag(user.cookie, item.id)).body).toEqual({ retired: true });
  });

  /** The point of the count. A reported question that keeps being asked is a
   *  reported question nobody fixed. */
  it('takes a retired item out of the extension queue', async () => {
    const { user, item } = await seedItem();

    expect((await request(app).get('/due').set('Cookie', user.cookie)).body.items).toHaveLength(1);

    for (let i = 0; i < RETIRED_FLAG_THRESHOLD; i += 1) await flag(user.cookie, item.id);

    expect((await request(app).get('/due').set('Cookie', user.cookie)).body.items).toEqual([]);
  });

  it('404s an item that does not exist', async () => {
    const { user } = await seedItem();
    const res = await flag(user.cookie, '11111111-1111-4111-8111-111111111111');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  it('400s a malformed id rather than letting it reach a uuid column', async () => {
    const { user } = await seedItem();
    expect((await flag(user.cookie, 'not-a-uuid')).status).toBe(400);
  });

  it('requires a session', async () => {
    const { item } = await seedItem();
    expect((await request(app).post(`/items/${item.id}/flag`)).status).toBe(401);
  });
});

describe('GET /items/:id/skeleton', () => {
  async function seedEditorItem() {
    const user = await seedUser();
    const [topic] = await db.insert(topics).values({ userId: user.id, title: 'T', status: 'active' }).returning({ id: topics.id });
    const [concept] = await db.insert(concepts).values({ topicId: topic!.id, slug: 'c', title: 'C', order: 1 }).returning({ id: concepts.id });
    const [item] = await db
      .insert(items)
      .values({
        conceptId: concept!.id,
        type: 'application',
        payload: {
          type: 'application',
          prompt: 'Write debounce.',
          answer: 'a debounce',
          blocks: [
            {
              kind: 'codeEditor',
              slot: 'answer',
              lang: 'javascript',
              signature: 'debounce(fn, ms)',
              starter: 'function debounce() {}',
              skeleton: 'function debounce(fn, ms) { let t; }',
              whyWhole: 'A blank cannot test that the timer handle is kept.',
              // Two minimum, by schema: the design says 2–4 named cases, and
              // one case is a spec nobody can debug against.
              cases: [
                { name: 'returns a function', call: 'typeof d', expect: 'function' },
                { name: 'delays', call: 'ran', expect: 'false' },
              ],
            },
          ],
        },
      })
      .returning({ id: items.id });
    return { user, item: item! };
  }

  /**
   * Fetched, never shipped. The skeleton is most of the answer, so sending it in
   * the payload would hand it to every learner including the ones who never
   * asked — and `assisted` would then measure who clicked rather than who
   * needed help.
   */
  it('serves the skeleton on request', async () => {
    const { user, item } = await seedEditorItem();
    const res = await request(app).get(`/items/${item.id}/skeleton`).set('Cookie', user.cookie);

    expect(res.status).toBe(200);
    expect(res.body.skeleton).toContain('let t');
  });

  it('is never in the item the learner is served', async () => {
    const { user, item } = await seedEditorItem();
    const skeleton = (await request(app).get(`/items/${item.id}/skeleton`).set('Cookie', user.cookie)).body.skeleton;

    const due = await request(app).get('/due').set('Cookie', user.cookie);
    expect(JSON.stringify(due.body)).not.toContain(skeleton);
    // The expected outputs stay behind for the same reason (T-080).
    expect(JSON.stringify(due.body)).not.toContain('"expect"');
  });

  it('404s an item that has no editor block', async () => {
    const { user, item } = await seedItem();
    const res = await request(app).get(`/items/${item.id}/skeleton`).set('Cookie', user.cookie);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('no_skeleton');
  });

  it('requires a session', async () => {
    const { item } = await seedEditorItem();
    expect((await request(app).get(`/items/${item.id}/skeleton`)).status).toBe(401);
  });
});
