import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { db } from '../../db/client.js';
import { concepts, reviewEvents, tests, topics } from '../../db/schema.js';
import { seedUser, truncateAll } from '../../test/db.js';
import { env } from '../../lib/env.js';
import { CSV_HEADER } from './admin.service.js';

const app = createApp();

/** `env` is parsed once at import, so the list is mutated in place rather than
 *  re-parsed — the same thing a deployment does by setting the variable. */
const originalAdmins = [...env.ADMIN_EMAILS];

beforeEach(async () => {
  await truncateAll();
  env.ADMIN_EMAILS.length = 0;
});

afterEach(() => {
  env.ADMIN_EMAILS.length = 0;
  env.ADMIN_EMAILS.push(...originalAdmins);
});

async function seedAdmin() {
  const user = await seedUser({ email: `founder-${Date.now()}@learnos.test` });
  env.ADMIN_EMAILS.push(user.email.toLowerCase());
  return user;
}

describe('the admin gate', () => {
  it('refuses a signed-in learner who is not on the list', async () => {
    const learner = await seedUser();

    const res = await request(app).get('/admin/metrics').set('Cookie', learner.cookie);

    expect(res.status).toBe(403);
  });

  it('refuses everyone when no admins are configured', async () => {
    // The failure mode of an unset variable has to be a locked door: this
    // endpoint shows every participant's results side by side.
    const anyone = await seedUser();
    expect(env.ADMIN_EMAILS).toHaveLength(0);

    const res = await request(app).get('/admin/metrics').set('Cookie', anyone.cookie);

    expect(res.status).toBe(403);
  });

  it('answers 401, not 403, when nobody is signed in', async () => {
    // Different questions: "who are you" and "not you". Collapsing them would
    // tell a signed-out founder they are not allowed.
    const res = await request(app).get('/admin/metrics');
    expect(res.status).toBe(401);
  });

  it('lets an admin through', async () => {
    const admin = await seedAdmin();

    const res = await request(app).get('/admin/metrics').set('Cookie', admin.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('rows');
    expect(res.body).toHaveProperty('cohort');
  });

  it('matches the email case-insensitively', async () => {
    // users.email is stored lowercased; an env file typed in mixed case must
    // not silently lock the founder out of their own dashboard.
    const admin = await seedUser({ email: `mixed-${Date.now()}@learnos.test` });
    env.ADMIN_EMAILS.length = 0;
    env.ADMIN_EMAILS.push(admin.email.toUpperCase().toLowerCase());

    expect((await request(app).get('/admin/metrics').set('Cookie', admin.cookie)).status).toBe(200);
  });

  it('guards the CSV export too', async () => {
    const learner = await seedUser();
    const [topic] = await db
      .insert(topics)
      .values({ userId: learner.id, title: 'T', status: 'active' })
      .returning({ id: topics.id });

    const res = await request(app)
      .get(`/admin/topics/${topic!.id}/reviews.csv`)
      .set('Cookie', learner.cookie);

    expect(res.status).toBe(403);
  });
});

describe('the report', () => {
  it('gives one row per user and topic, with cohort means beside their n', async () => {
    const admin = await seedAdmin();
    const learner = await seedUser();
    for (const title of ['Distributed systems', 'React']) {
      const [topic] = await db
        .insert(topics)
        .values({ userId: learner.id, title, status: 'active' })
        .returning({ id: topics.id });
      await db.insert(tests).values({
        userId: learner.id,
        topicId: topic!.id,
        kind: 'day0',
        itemIds: [],
        scores: { overall: 0.4, taught: 0.4, heldOut: 0.4, transfer: 0.4, calibrationGap: 0.2, perConcept: {} },
      });
      await db.insert(tests).values({
        userId: learner.id,
        topicId: topic!.id,
        kind: 'day30',
        itemIds: [],
        scores: { overall: 0.8, taught: 0.9, heldOut: 0.5, transfer: 0.6, calibrationGap: 0.1, perConcept: {} },
      });
    }

    const res = await request(app).get('/admin/metrics').set('Cookie', admin.cookie);

    // Two rows for the learner's two topics — a learner on two topics is two
    // independent measurements, not one person-shaped average.
    const learnerRows = res.body.rows.filter((r: { userId: string }) => r.userId === learner.id);
    expect(learnerRows).toHaveLength(2);
    expect(learnerRows[0].retentionGain).toBe(0.4);
    expect(res.body.cohort.retentionGain).toBe(0.4);
    expect(res.body.cohort.n.retentionGain).toBe(2);
  });

  it('excludes a missing number from the mean instead of counting it as zero', async () => {
    // The founder's row has no tests at all. Folding a zero in would report a
    // cohort gain of 0.2 when the one measured participant scored 0.4.
    const admin = await seedAdmin();
    const learner = await seedUser();
    const [topic] = await db
      .insert(topics)
      .values({ userId: learner.id, title: 'T', status: 'active' })
      .returning({ id: topics.id });
    await db.insert(topics).values({ userId: admin.id, title: 'Untouched', status: 'active' });
    await db.insert(tests).values({
      userId: learner.id, topicId: topic!.id, kind: 'day0', itemIds: [],
      scores: { overall: 0.4, taught: 0.4, heldOut: 0.4, transfer: 0.4, calibrationGap: 0.2, perConcept: {} },
    });
    await db.insert(tests).values({
      userId: learner.id, topicId: topic!.id, kind: 'day30', itemIds: [],
      scores: { overall: 0.8, taught: 0.9, heldOut: 0.5, transfer: 0.6, calibrationGap: 0.1, perConcept: {} },
    });

    const res = await request(app).get('/admin/metrics').set('Cookie', admin.cookie);

    expect(res.body.rows).toHaveLength(2);
    expect(res.body.cohort.retentionGain).toBe(0.4);
    expect(res.body.cohort.n.retentionGain).toBe(1);
  });
});

describe('the CSV export', () => {
  it('has the expected header', async () => {
    const admin = await seedAdmin();
    const [topic] = await db
      .insert(topics)
      .values({ userId: admin.id, title: 'T', status: 'active' })
      .returning({ id: topics.id });

    const res = await request(app)
      .get(`/admin/topics/${topic!.id}/reviews.csv`)
      .set('Cookie', admin.cookie);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text.split('\n')[0]).toBe(CSV_HEADER.join(','));
  });

  it('joins the concept slug and held-out flag so the file stands alone', async () => {
    const admin = await seedAdmin();
    const [topic] = await db
      .insert(topics)
      .values({ userId: admin.id, title: 'T', status: 'active' })
      .returning({ id: topics.id });
    const [concept] = await db
      .insert(concepts)
      .values({ topicId: topic!.id, slug: 'leases', title: 'Leases', order: 1, heldOut: true })
      .returning({ id: concepts.id });
    await db.insert(reviewEvents).values({
      userId: admin.id,
      conceptId: concept!.id,
      correct: true,
      predictedRecall: 0.8,
      gapDaysSinceLast: 3,
      surface: 'web',
    });

    const res = await request(app)
      .get(`/admin/topics/${topic!.id}/reviews.csv`)
      .set('Cookie', admin.cookie);
    const [, row] = res.text.split('\n');

    // A column of UUIDs is not analysable by a human.
    expect(row).toContain('leases');
    expect(row).toContain('true');
  });

  it('quotes a slug containing a comma rather than shifting every column after it', async () => {
    // A shifted column is a wrong analysis, not a broken file — much worse.
    const admin = await seedAdmin();
    const [topic] = await db
      .insert(topics)
      .values({ userId: admin.id, title: 'T', status: 'active' })
      .returning({ id: topics.id });
    const [concept] = await db
      .insert(concepts)
      .values({ topicId: topic!.id, slug: 'a,b', title: 'A', order: 1 })
      .returning({ id: concepts.id });
    await db.insert(reviewEvents).values({
      userId: admin.id, conceptId: concept!.id, correct: true, predictedRecall: 0.8, surface: 'web',
    });

    const res = await request(app)
      .get(`/admin/topics/${topic!.id}/reviews.csv`)
      .set('Cookie', admin.cookie);
    const [, row] = res.text.split('\n');

    expect(row).toContain('"a,b"');
    expect(row!.split(',')).toHaveLength(CSV_HEADER.length + 1); // the quoted comma
  });

  it('carries no prompt and no answer text', async () => {
    // This file gets mailed to a co-founder and left in a downloads folder. It
    // holds what happened, not what was said.
    expect(CSV_HEADER).not.toContain('prompt');
    expect(CSV_HEADER).not.toContain('response');
    expect(CSV_HEADER).not.toContain('answer');
  });
});
