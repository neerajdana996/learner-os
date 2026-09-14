import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../app.js';
import { db } from '../../db/client.js';
import { cards, concepts, items, reviewEvents, topics } from '../../db/schema.js';
import { seedUser, truncateAll } from '../../test/db.js';
import { toPublicItem } from '../../lib/publicItem.js';
import { RETIRED_FLAG_THRESHOLD } from '../../lib/retire.js';

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
  distractorSource: 'the nearest wrong belief a learner still holds',
};

const explainPayload = { type: 'explain' as const, prompt: 'Explain', rubric: 'SECRET RUBRIC' };

async function seedUserWithTopic(
  status: 'active' | 'holdout' | 'generating' = 'active',
  endsAt: Date | null = null,
) {
  const user = await seedUser();
  const [topic] = await db.insert(topics).values({ userId: user.id, title: 'T', status, endsAt }).returning({ id: topics.id });
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
    /** Normally derived by the worker via `answerKindOf` (T-080). Set directly
     *  here so a test can seed a format the popup must refuse. */
    answerKind?: string | null;
    /** At `RETIRED_FLAG_THRESHOLD` the item is retired and never served. */
    flaggedBad?: number;
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
        answerKind: opts.answerKind ?? null,
        flaggedBad: opts.flaggedBad ?? 0,
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

const getDue = (cookie: string, query = '') => request(app).get(`/due${query}`).set('Cookie', cookie);

beforeEach(async () => {
  await truncateAll();
});

describe('GET /due', () => {
  it('excludes a card that has not been taught', async () => {
    const { user, topic } = await seedUserWithTopic();
    await seedDueConcept(user.id, topic.id, { slug: 'a', order: 1, taught: false });

    const res = await getDue(user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('excludes a held-out concept', async () => {
    const { user, topic } = await seedUserWithTopic();
    await seedDueConcept(user.id, topic.id, { slug: 'a', order: 4, heldOut: true });

    expect((await getDue(user.cookie)).body.items).toEqual([]);
  });

  it('excludes topics in holdout status', async () => {
    const { user, topic } = await seedUserWithTopic('holdout');
    await seedDueConcept(user.id, topic.id, { slug: 'a', order: 1 });

    expect((await getDue(user.cookie)).body.items).toEqual([]);
  });

  /**
   * The extension's queue is the surface the silence has to hold. Days 8–29
   * carry no cards at all (plan.md §2) — a review arriving on day 20 means the
   * day-30 test is not cold, and the pilot's only number stops meaning
   * anything. `status` alone cannot express this: it stays 'active' forever,
   * because nothing ever writes 'done'.
   */
  it('excludes a topic whose end date has passed, however overdue the card is', async () => {
    const { user, topic } = await seedUserWithTopic('active', new Date(Date.now() - 86_400_000));
    await seedDueConcept(user.id, topic.id, { slug: 'a', order: 1 });

    expect((await getDue(user.cookie)).body.items).toEqual([]);
  });

  it('still serves a topic whose end date is ahead', async () => {
    const { user, topic } = await seedUserWithTopic('active', new Date(Date.now() + 86_400_000));
    await seedDueConcept(user.id, topic.id, { slug: 'a', order: 1 });

    expect((await getDue(user.cookie)).body.items).toHaveLength(1);
  });

  it('excludes cards that are not due yet', async () => {
    const { user, topic } = await seedUserWithTopic();
    await seedDueConcept(user.id, topic.id, { slug: 'a', order: 1, due: future(2) });

    expect((await getDue(user.cookie)).body.items).toEqual([]);
  });

  it('returns two due cards ordered by due ascending', async () => {
    const { user, topic } = await seedUserWithTopic();
    const older = await seedDueConcept(user.id, topic.id, { slug: 'older', order: 1, due: past(5) });
    const newer = await seedDueConcept(user.id, topic.id, { slug: 'newer', order: 2, due: past(1) });

    const res = await getDue(user.cookie);
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

    expect((await getDue(user.cookie, '?limit=1')).body.items).toHaveLength(1);
  });

  it('rejects a limit outside the allowed range', async () => {
    const { user } = await seedUserWithTopic();
    expect((await getDue(user.cookie, '?limit=0')).status).toBe(400);
    expect((await getDue(user.cookie, '?limit=999')).status).toBe(400);
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

    const res = await getDue(user.cookie);
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

    const res = await getDue(user.cookie);
    expect(res.body.items[0].itemId).toBe(only);
  });

  it('never leaks answer, accept, answerIndex or rubric', async () => {
    const { user, topic } = await seedUserWithTopic();
    await seedDueConcept(user.id, topic.id, { slug: 'a', order: 1, due: past(5), payloads: [recallPayload('Q')] });
    await seedDueConcept(user.id, topic.id, { slug: 'b', order: 2, due: past(4), payloads: [recognitionPayload] });
    await seedDueConcept(user.id, topic.id, { slug: 'c', order: 3, due: past(3), payloads: [explainPayload] });

    const res = await getDue(user.cookie);
    expect(res.body.items).toHaveLength(3);

    // By key inspection, per the acceptance criterion... `conceptTitle` is
    // populated only by `/due` (T-130): every due item is taught and never
    // held out, so naming the concept here reveals nothing the learner
    // doesn't already know — unlike `toPublicItem`'s shared projection, which
    // also serves the diagnostic and the Day-30 test and must keep
    // withholding it for a held-out concept.
    for (const item of res.body.items) {
      expect(Object.keys(item).sort()).toEqual(
        item.type === 'recognition'
          ? ['conceptId', 'conceptTitle', 'itemId', 'options', 'prompt', 'type']
          : ['conceptId', 'conceptTitle', 'itemId', 'prompt', 'type'],
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

    expect((await getDue(other.cookie)).body.items).toEqual([]);
  });

  /**
   * T-171 (founder decision 2026-09-14). This used to assert that a
   * `codeEditor` is never served here (T-089). The side panel stays open while
   * the learner writes, runs the code through its sandbox page, and non-JS
   * answers are judged on the server — so it is a review on this surface now.
   */
  it('serves a codeEditor card to the panel, which used to be refused', async () => {
    const { user, topic } = await seedUserWithTopic();
    await seedDueConcept(user.id, topic.id, { slug: 'a', order: 1, answerKind: 'codeEditor' });

    expect((await getDue(user.cookie)).body.items).toHaveLength(1);
  });

  it('still serves the cheap answer formats', async () => {
    const { user, topic } = await seedUserWithTopic();
    await seedDueConcept(user.id, topic.id, { slug: 'a', order: 1, answerKind: 'clozeCode' });

    // 15–30s and one short blank: exactly what the card is for.
    expect((await getDue(user.cookie)).body.items).toHaveLength(1);
  });

  it('serves a plain item, which is every item generated before blocks existed', async () => {
    const { user, topic } = await seedUserWithTopic();
    await seedDueConcept(user.id, topic.id, { slug: 'a', order: 1, answerKind: null });

    // A null answer_kind must stay eligible or the extension goes quiet for
    // every existing topic.
    expect((await getDue(user.cookie)).body.items).toHaveLength(1);
  });

  /**
   * T-169. The LIMIT used to be spent on due *cards*, with eligibility applied
   * afterwards to their *items* — so an ineligible card consumed a row and then
   * dropped out, returning nothing.
   *
   * The popup asks for exactly one (`Popup.tsx`'s `fetchDue`), which makes this
   * the quietest failure in the product: a learner whose earliest-due concept
   * happens to hold an unservable item is told "nothing due right now" while
   * every other card is due and answerable, and the extension simply stops
   * asking.
   *
   * The blocked card was a `codeEditor` until T-171 made every format servable
   * here. A retired item goes through the same `servableItem()` condition, so
   * it keeps this regression covered without depending on a format rule.
   */
  it('skips past an ineligible card rather than spending the limit on it', async () => {
    const { user, topic } = await seedUserWithTopic();
    // Due first, and unservable: its only item has been retired.
    await seedDueConcept(user.id, topic.id, { slug: 'blocked', order: 1, due: past(5), flaggedBad: RETIRED_FLAG_THRESHOLD });
    // Due later, and perfectly answerable.
    await seedDueConcept(user.id, topic.id, { slug: 'servable', order: 2, due: past(1), answerKind: null });

    const { body } = await getDue(user.cookie, '?limit=1');
    expect(body.items).toHaveLength(1);
    expect(body.items[0].conceptTitle).toBe('servable');
  });

  /**
   * `orderLines` reaches the panel now (T-170).
   *
   * It was refused for being "a drag that needs a pointer and room to drop",
   * and both halves stopped being true: the side panel replaced a 380×300
   * popup, and `OrderLines` has never dragged — it is up/down buttons, each
   * clearing a 44px tap target, because HTML5 drag does not fire on touch.
   *
   * This replaces a test that asserted the opposite. Since T-171 both the
   * panel and review exclusion lists are empty, so the skip-past behaviour is
   * covered by the retired-item case above. Add a format case here if a
   * format is ever refused by one surface again.
   */
  it('serves an orderLines card to the panel, which used to be refused', async () => {
    const { user, topic } = await seedUserWithTopic();
    await seedDueConcept(user.id, topic.id, { slug: 'drag', order: 1, due: past(5), answerKind: 'orderLines' });

    const { body } = await getDue(user.cookie, '?limit=1');
    expect(body.items).toHaveLength(1);
    expect(body.items[0].conceptTitle).toBe('drag');
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

  // T-080. The block-level projection is tested exhaustively in
  // shared/__tests__/blocks.test.ts; this is the seam — that an item carrying
  // blocks goes through it at all, and that one without is untouched.
  it('carries blocks through the projection, stripped, with the reveal dropped', () => {
    const publicItem = toPublicItem({
      ...ids,
      payload: {
        type: 'application',
        prompt: 'Fix the bound.',
        answer: 'lo < hi',
        blocks: [
          {
            kind: 'clozeCode',
            slot: 'answer',
            lang: 'javascript',
            src: 'while (lo {{1}} hi) {',
            holes: [{ id: 1, answer: 'LEAKEDANSWER', accept: ['LEAKEDACCEPT'], width: 2 }],
            failure: 'search([4], 4) returns -1',
          },
          { kind: 'prose', slot: 'reveal', text: 'LEAKEDREVEAL' },
        ],
      },
    });

    expect(Object.keys(publicItem).sort()).toEqual(['blocks', 'conceptId', 'itemId', 'prompt', 'type']);
    expect(publicItem.blocks).toHaveLength(1);
    expect(JSON.stringify(publicItem)).not.toMatch(/LEAKED/);
  });

  it('omits blocks entirely for an item that has none', () => {
    expect(toPublicItem({ ...ids, payload: recallPayload('Q') })).not.toHaveProperty('blocks');
  });
});
