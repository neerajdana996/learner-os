import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import { MeExportSchema } from '@learnos/shared';
import { createApp } from '../../app.js';
import { db, pg } from '../../db/client.js';
import {
  authTokens,
  cards,
  clientEvents,
  conceptPrereqs,
  concepts,
  dailyPulse,
  items,
  oauthAccounts,
  reviewEvents,
  sessionDays,
  sessions,
  tests,
  topics,
  users,
} from '../../db/schema.js';
import { loginAs, seedUser, truncateAll } from '../../test/db.js';

const app = createApp();

const win = (start: string, end: string) => ({ start, end });

beforeEach(async () => {
  await truncateAll();
});

describe('GET /me', () => {
  it('returns everything the extension needs in one request', async () => {
    const user = await seedUser({ name: 'Ada' });

    const res = await request(app).get('/me').set('Cookie', user.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: user.id,
      email: user.email,
      name: 'Ada',
      timezone: null,
      activeWindows: [],
      // Defaulted rather than absent, so T-028 never handles a missing cap.
      profile: { dailyCap: 12, calibrationGap: null },
      hasExtensionToken: false,
    });
  });

  it('reports hasExtensionToken once one is issued', async () => {
    const user = await seedUser();
    await loginAs(user.id, 'extension');

    const res = await request(app).get('/me').set('Cookie', user.cookie);
    expect(res.body.hasExtensionToken).toBe(true);
  });

  it('never returns another user’s data', async () => {
    const user = await seedUser();
    const other = await seedUser();

    const res = await request(app).get('/me').set('Cookie', other.cookie);
    expect(res.body.id).toBe(other.id);
    expect(res.body.id).not.toBe(user.id);
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/me')).status).toBe(401);
  });
});

describe('PATCH /me', () => {
  const patch = (cookie: string, body: object) =>
    request(app).patch('/me').set('Cookie', cookie).send(body);

  it('persists a valid two-window profile', async () => {
    const user = await seedUser();
    const activeWindows = [win('09:00', '12:00'), win('14:00', '17:30')];

    const res = await patch(user.cookie, { timezone: 'Asia/Kolkata', activeWindows });

    expect(res.status).toBe(200);
    expect(res.body.timezone).toBe('Asia/Kolkata');
    expect(res.body.activeWindows).toEqual(activeWindows);

    const reread = await request(app).get('/me').set('Cookie', user.cookie);
    expect(reread.body.activeWindows).toEqual(activeWindows);
  });

  it('rejects overlapping windows', async () => {
    const user = await seedUser();
    const res = await patch(user.cookie, {
      activeWindows: [win('09:00', '12:00'), win('11:00', '13:00')],
    });
    expect(res.status).toBe(400);
  });

  it('accepts adjacent windows that touch but do not overlap', async () => {
    const user = await seedUser();
    const res = await patch(user.cookie, {
      activeWindows: [win('09:00', '12:00'), win('12:00', '15:00')],
    });
    expect(res.status).toBe(200);
  });

  it('rejects four windows', async () => {
    const user = await seedUser();
    const res = await patch(user.cookie, {
      activeWindows: [
        win('06:00', '07:00'),
        win('08:00', '09:00'),
        win('10:00', '11:00'),
        win('12:00', '13:00'),
      ],
    });
    expect(res.status).toBe(400);
  });

  it('rejects a window whose end is not after its start', async () => {
    const user = await seedUser();
    expect((await patch(user.cookie, { activeWindows: [win('12:00', '12:00')] })).status).toBe(400);
    expect((await patch(user.cookie, { activeWindows: [win('15:00', '09:00')] })).status).toBe(400);
  });

  it('rejects malformed times', async () => {
    const user = await seedUser();
    for (const bad of [win('9:00', '12:00'), win('24:00', '25:00'), win('12:60', '13:00')]) {
      expect((await patch(user.cookie, { activeWindows: [bad] })).status).toBe(400);
    }
  });

  it('rejects an unknown timezone and accepts a real one', async () => {
    const user = await seedUser();
    expect((await patch(user.cookie, { timezone: 'Mars/Olympus' })).status).toBe(400);
    expect((await patch(user.cookie, { timezone: 'America/Los_Angeles' })).status).toBe(200);
  });

  it('leaves omitted fields untouched', async () => {
    const user = await seedUser({ name: 'Ada' });
    const activeWindows = [win('09:00', '12:00')];
    await patch(user.cookie, { timezone: 'Europe/London', activeWindows });

    await patch(user.cookie, { name: 'Grace' });

    const res = await request(app).get('/me').set('Cookie', user.cookie);
    expect(res.body.name).toBe('Grace');
    expect(res.body.timezone).toBe('Europe/London');
    expect(res.body.activeWindows).toEqual(activeWindows);
  });

  it('clears the name when explicitly null', async () => {
    const user = await seedUser({ name: 'Ada' });
    const res = await patch(user.cookie, { name: null });
    expect(res.body.name).toBeNull();
  });

  it('accepts an empty patch as a no-op', async () => {
    const user = await seedUser({ name: 'Ada' });
    const res = await patch(user.cookie, {});
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Ada');
  });

  it('rejects an invalid patch without writing anything', async () => {
    const user = await seedUser({ name: 'Ada' });
    await patch(user.cookie, { timezone: 'Europe/London' });

    const res = await patch(user.cookie, {
      timezone: 'Nowhere/Nothing',
      activeWindows: [win('09:00', '12:00')],
    });

    expect(res.status).toBe(400);
    // The valid half of a rejected patch must not land.
    const reread = await request(app).get('/me').set('Cookie', user.cookie);
    expect(reread.body.timezone).toBe('Europe/London');
    expect(reread.body.activeWindows).toEqual([]);
  });

  it('requires authentication', async () => {
    expect((await request(app).patch('/me').send({ name: 'x' })).status).toBe(401);
  });
});

/**
 * T-046 — a learner's own copy of their data, and deleting their account.
 *
 * One row in every table that can hold something of theirs, with marker
 * strings in the three places an export must never reach: an answer key, a
 * held-out concept's title, and a credential hash.
 */
async function seedEverything(userId: string, tag: string) {
  const [topic] = await db
    .insert(topics)
    .values({ userId, title: `Topic ${tag}`, why: 'to remember', status: 'active' })
    .returning({ id: topics.id });
  if (!topic) throw new Error('no topic');
  const [taught] = await db
    .insert(concepts)
    .values({ topicId: topic.id, slug: `taught-${tag}`, title: `Taught ${tag}`, order: 1 })
    .returning({ id: concepts.id });
  const [held] = await db
    .insert(concepts)
    .values({ topicId: topic.id, slug: `held-${tag}`, title: `HELD-OUT-TITLE-${tag}`, order: 2, heldOut: true })
    .returning({ id: concepts.id });
  if (!taught || !held) throw new Error('no concepts');

  await db.insert(conceptPrereqs).values({ conceptId: held.id, prerequisiteConceptId: taught.id });
  const [item] = await db
    .insert(items)
    .values({ conceptId: taught.id, type: 'recall', payload: { type: 'recall', prompt: 'Q', answer: `SECRET-ANSWER-${tag}` } })
    .returning({ id: items.id });
  const [card] = await db
    .insert(cards)
    .values({ userId, conceptId: taught.id, due: new Date() })
    .returning({ id: cards.id });
  if (!item || !card) throw new Error('no item or card');

  await db
    .insert(reviewEvents)
    .values({ userId, conceptId: taught.id, itemId: item.id, cardId: card.id, correct: true, predictedRecall: 0.9 });
  await db.insert(tests).values({ userId, topicId: topic.id, kind: 'day30' });
  await db.insert(dailyPulse).values({ userId, date: new Date('2026-09-14T00:00:00Z'), mood: 2 });
  await db.insert(clientEvents).values({ userId, event: 'card_shown', at: new Date() });
  await db.insert(authTokens).values({ userId, token: `TOKEN-HASH-${tag}`, expiresAt: new Date(Date.now() + 60_000) });
  await db
    .insert(oauthAccounts)
    .values({ userId, provider: 'github', providerUserId: `gh-${tag}`, email: `gh-${tag}@example.com` });
  await db.insert(sessionDays).values({ userId, topicId: topic.id, day: '2026-09-14' });

  return { topicId: topic.id, conceptIds: [taught.id, held.id] };
}

/** How many rows, in each table, still belong to this learner or their content. */
async function rowsFor(userId: string, topicId: string, conceptIds: string[]) {
  const n = async (rows: Promise<unknown[]>) => (await rows).length;
  return {
    users: await n(db.select({ id: users.id }).from(users).where(eq(users.id, userId))),
    topics: await n(db.select({ id: topics.id }).from(topics).where(eq(topics.userId, userId))),
    concepts: await n(db.select({ id: concepts.id }).from(concepts).where(eq(concepts.topicId, topicId))),
    conceptPrereqs: await n(
      db.select({ id: conceptPrereqs.conceptId }).from(conceptPrereqs).where(inArray(conceptPrereqs.conceptId, conceptIds)),
    ),
    items: await n(db.select({ id: items.id }).from(items).where(inArray(items.conceptId, conceptIds))),
    cards: await n(db.select({ id: cards.id }).from(cards).where(eq(cards.userId, userId))),
    reviewEvents: await n(db.select({ id: reviewEvents.id }).from(reviewEvents).where(eq(reviewEvents.userId, userId))),
    tests: await n(db.select({ id: tests.id }).from(tests).where(eq(tests.userId, userId))),
    dailyPulse: await n(db.select({ id: dailyPulse.id }).from(dailyPulse).where(eq(dailyPulse.userId, userId))),
    clientEvents: await n(db.select({ id: clientEvents.id }).from(clientEvents).where(eq(clientEvents.userId, userId))),
    authTokens: await n(db.select({ id: authTokens.id }).from(authTokens).where(eq(authTokens.userId, userId))),
    oauthAccounts: await n(db.select({ id: oauthAccounts.id }).from(oauthAccounts).where(eq(oauthAccounts.userId, userId))),
    sessions: await n(db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId))),
    sessionDays: await n(db.select({ id: sessionDays.id }).from(sessionDays).where(eq(sessionDays.userId, userId))),
  };
}

describe('DELETE /me (T-046)', () => {
  const del = (cookie: string, body: object) => request(app).delete('/me').set('Cookie', cookie).send(body);

  it('removes the learner, and everything attached to them, from every table', async () => {
    const user = await seedUser();
    await loginAs(user.id, 'extension');
    const { topicId, conceptIds } = await seedEverything(user.id, 'a');
    // Proof the seed reached every table, so the zeros below mean something.
    expect(Object.values(await rowsFor(user.id, topicId, conceptIds)).every((count) => count > 0)).toBe(true);

    const res = await del(user.cookie, { confirmEmail: user.email });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });
    const left = await rowsFor(user.id, topicId, conceptIds);
    expect(left).toEqual(Object.fromEntries(Object.keys(left).map((table) => [table, 0])));
  });

  it('leaves another learner exactly as they were', async () => {
    const leaving = await seedUser();
    const staying = await seedUser();
    await seedEverything(leaving.id, 'leaving');
    const kept = await seedEverything(staying.id, 'staying');
    const before = await rowsFor(staying.id, kept.topicId, kept.conceptIds);

    expect((await del(leaving.cookie, { confirmEmail: leaving.email })).status).toBe(200);

    expect(await rowsFor(staying.id, kept.topicId, kept.conceptIds)).toEqual(before);
    expect((await request(app).get('/me').set('Cookie', staying.cookie)).status).toBe(200);
  });

  /**
   * No foreign key cascades, so a table added later that references a user, a
   * topic or a concept — and is not handled by the deletion — would make
   * `DELETE /me` fail in production with a constraint error. This fails here
   * first, naming the table.
   */
  it('handles every table that can hold a learner’s rows', async () => {
    const rows = await pg<{ table_name: string; referenced: string }[]>`
      SELECT DISTINCT tc.table_name, ccu.table_name AS referenced
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND ccu.table_name IN ('users', 'topics', 'concepts', 'items', 'cards')
    `;
    const referencing = [...new Set(rows.map((row) => row.table_name))].sort();

    expect(referencing).toEqual(
      [
        'auth_tokens',
        'cards',
        'client_events',
        'concept_prereqs',
        'concepts',
        'daily_pulse',
        'items',
        'oauth_accounts',
        'review_events',
        'session_days',
        'sessions',
        'tests',
        'topics',
      ].sort(),
    );
  });

  it('refuses a confirmation that is not the account’s address, and deletes nothing', async () => {
    const user = await seedUser();
    const { topicId, conceptIds } = await seedEverything(user.id, 'a');
    const before = await rowsFor(user.id, topicId, conceptIds);

    const res = await del(user.cookie, { confirmEmail: 'someone-else@example.com' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'email_mismatch' });
    expect(await rowsFor(user.id, topicId, conceptIds)).toEqual(before);
  });

  it('accepts the confirmation typed in a different case', async () => {
    const user = await seedUser();
    expect((await del(user.cookie, { confirmEmail: user.email.toUpperCase() })).status).toBe(200);
  });

  it('refuses a request with no confirmation at all', async () => {
    const user = await seedUser();
    expect((await del(user.cookie, {})).status).toBe(400);
    expect((await request(app).get('/me').set('Cookie', user.cookie)).status).toBe(200);
  });

  it('signs the learner out on the web and in the extension', async () => {
    const user = await seedUser();
    const extension = await loginAs(user.id, 'extension');

    const res = await del(user.cookie, { confirmEmail: user.email });

    expect(String(res.headers['set-cookie'])).toMatch(/learnos_session=;/);
    expect((await request(app).get('/me').set('Cookie', user.cookie)).status).toBe(401);
    expect((await request(app).get('/me').set('Authorization', extension.bearer)).status).toBe(401);
  });

  it('requires authentication', async () => {
    expect((await request(app).delete('/me').send({ confirmEmail: 'a@example.com' })).status).toBe(401);
  });
});

describe('GET /me/export (T-046)', () => {
  it('returns everything held about the learner, with counts', async () => {
    const user = await seedUser();
    await seedEverything(user.id, 'a');

    const res = await request(app).get('/me/export').set('Cookie', user.cookie);

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    const body = MeExportSchema.parse(res.body);
    expect(body.account.email).toBe(user.email);
    expect(body.counts.reviewEvents).toBe(1);
    expect(body.reviewEvents).toHaveLength(1);
    expect(body.topics.map((t) => t.title)).toEqual(['Topic a']);
    expect(body.cards).toHaveLength(1);
    expect(body.tests).toHaveLength(1);
    expect(body.dailyPulse).toEqual([{ date: '2026-09-14', mood: 2 }]);
    expect(body.signIns.providers).toEqual([
      expect.objectContaining({ provider: 'github', email: 'gh-a@example.com' }),
    ]);
  });

  /**
   * The three things a copy must never carry. Answer keys and held-out titles
   * would change the Day-30 measurement; credential hashes are secrets.
   */
  it('never contains an answer key, a held-out concept, or a credential', async () => {
    const user = await seedUser();
    await seedEverything(user.id, 'a');

    const res = await request(app).get('/me/export').set('Cookie', user.cookie);
    const text = JSON.stringify(res.body);

    expect(text).not.toContain('SECRET-ANSWER');
    expect(text).not.toContain('HELD-OUT-TITLE');
    expect(text).not.toContain('TOKEN-HASH');
    expect(res.body.concepts.map((c: { title: string }) => c.title)).toEqual(['Taught a']);
  });

  it('contains nothing that belongs to another learner', async () => {
    const user = await seedUser();
    const other = await seedUser();
    await seedEverything(user.id, 'mine');
    await seedEverything(other.id, 'theirs');

    const text = JSON.stringify((await request(app).get('/me/export').set('Cookie', user.cookie)).body);

    expect(text).not.toContain('theirs');
    expect(text).not.toContain(other.email);
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/me/export')).status).toBe(401);
  });
});
