import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../app.js';
import { db } from '../../db/client.js';
import { dailyPulse } from '../../db/schema.js';
import { seedUser, truncateAll } from '../../test/db.js';

const app = createApp();

beforeEach(async () => {
  await truncateAll();
});

describe('POST /pulse', () => {
  it('records one tap', async () => {
    const user = await seedUser();

    const res = await request(app)
      .post('/pulse')
      .set('Cookie', user.cookie)
      .send({ day: '2026-09-06', mood: 2 });

    expect(res.status).toBe(200);
    const rows = await db.select().from(dailyPulse).where(eq(dailyPulse.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.mood).toBe(2);
  });

  it('is idempotent — a retry does not make a second row', async () => {
    // The tap is fire-and-forget from a popup that may be closing, so a double
    // send is normal rather than exceptional.
    const user = await seedUser();
    const body = { day: '2026-09-06', mood: 2 };

    await request(app).post('/pulse').set('Cookie', user.cookie).send(body);
    await request(app).post('/pulse').set('Cookie', user.cookie).send(body);

    const rows = await db.select().from(dailyPulse).where(eq(dailyPulse.userId, user.id));
    expect(rows).toHaveLength(1);
  });

  it('lets the last tap of the day win', async () => {
    const user = await seedUser();

    await request(app).post('/pulse').set('Cookie', user.cookie).send({ day: '2026-09-06', mood: 1 });
    await request(app).post('/pulse').set('Cookie', user.cookie).send({ day: '2026-09-06', mood: 3 });

    const rows = await db.select().from(dailyPulse).where(eq(dailyPulse.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.mood).toBe(3);
  });

  it('keeps separate days apart', async () => {
    const user = await seedUser();

    await request(app).post('/pulse').set('Cookie', user.cookie).send({ day: '2026-09-06', mood: 1 });
    await request(app).post('/pulse').set('Cookie', user.cookie).send({ day: '2026-09-07', mood: 3 });

    const rows = await db.select().from(dailyPulse).where(eq(dailyPulse.userId, user.id));
    expect(rows).toHaveLength(2);
  });

  it('does not collide between two learners on the same day', async () => {
    const one = await seedUser();
    const two = await seedUser();

    await request(app).post('/pulse').set('Cookie', one.cookie).send({ day: '2026-09-06', mood: 1 });
    await request(app).post('/pulse').set('Cookie', two.cookie).send({ day: '2026-09-06', mood: 3 });

    expect(await db.select().from(dailyPulse)).toHaveLength(2);
  });

  it('rejects a mood outside the three faces', async () => {
    const user = await seedUser();

    const res = await request(app)
      .post('/pulse')
      .set('Cookie', user.cookie)
      .send({ day: '2026-09-06', mood: 7 });

    expect(res.status).toBe(400);
  });

  it('rejects a day that is not a date', async () => {
    const user = await seedUser();

    const res = await request(app)
      .post('/pulse')
      .set('Cookie', user.cookie)
      .send({ day: 'today', mood: 2 });

    expect(res.status).toBe(400);
  });

  it('requires a user', async () => {
    const res = await request(app).post('/pulse').send({ day: '2026-09-06', mood: 2 });
    expect(res.status).toBe(401);
  });
});
