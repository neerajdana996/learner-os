import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../app.js';
import { db } from '../../db/client.js';
import { clientEvents } from '../../db/schema.js';
import { seedUser, truncateAll } from '../../test/db.js';

const app = createApp();

beforeEach(async () => {
  await truncateAll();
});

describe('POST /telemetry', () => {
  it('stores each of the three event types', async () => {
    const user = await seedUser();

    const res = await request(app)
      .post('/telemetry')
      .set('Cookie', user.cookie)
      .send({
        events: [
          { event: 'card_shown', meta: { itemId: 'a' } },
          { event: 'card_closed_no_action', meta: { itemId: 'a' } },
          { event: 'popup_error', meta: { message: 'boom' } },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ stored: 3 });
    const rows = await db.select().from(clientEvents).where(eq(clientEvents.userId, user.id));
    expect(rows.map((r) => r.event).sort()).toEqual([
      'card_closed_no_action',
      'card_shown',
      'popup_error',
    ]);
  });

  it('keeps the time the event happened, not the time it arrived', async () => {
    // The worker batches on a five-minute alarm, so every event is late by
    // construction. An answer-rate measured on arrival times would smear
    // everything into whichever five minutes the flush landed in.
    const user = await seedUser();
    const at = '2026-09-06T09:15:00.000Z';

    await request(app)
      .post('/telemetry')
      .set('Cookie', user.cookie)
      .send({ events: [{ event: 'card_shown', at }] });

    const [row] = await db.select().from(clientEvents).where(eq(clientEvents.userId, user.id));
    expect(row?.at.toISOString()).toBe(at);
  });

  it('clamps a device clock running ahead', async () => {
    // A future stamp would sit beyond the end of every window a metric asks
    // for, and the event would vanish from the counts it exists to feed.
    const user = await seedUser();
    const future = new Date(Date.now() + 86_400_000).toISOString();

    await request(app)
      .post('/telemetry')
      .set('Cookie', user.cookie)
      .send({ events: [{ event: 'card_shown', at: future }] });

    const [row] = await db.select().from(clientEvents).where(eq(clientEvents.userId, user.id));
    expect(row!.at.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('falls back to now on an unusable stamp rather than losing the batch', async () => {
    const user = await seedUser();

    const res = await request(app)
      .post('/telemetry')
      .set('Cookie', user.cookie)
      .send({ events: [{ event: 'card_shown' }] });

    expect(res.status).toBe(200);
    const [row] = await db.select().from(clientEvents).where(eq(clientEvents.userId, user.id));
    expect(row?.at).toBeInstanceOf(Date);
  });

  it('refuses an event name nobody defined', async () => {
    // The column is free text so a new event needs no migration; the union at
    // the boundary is what keeps garbage out.
    const user = await seedUser();

    const res = await request(app)
      .post('/telemetry')
      .set('Cookie', user.cookie)
      .send({ events: [{ event: 'card_eaten' }] });

    expect(res.status).toBe(400);
    expect(await db.select().from(clientEvents)).toHaveLength(0);
  });

  it('refuses an empty batch and an oversized one', async () => {
    const user = await seedUser();
    const many = Array.from({ length: 51 }, () => ({ event: 'card_shown' as const }));

    expect((await request(app).post('/telemetry').set('Cookie', user.cookie).send({ events: [] })).status).toBe(400);
    expect((await request(app).post('/telemetry').set('Cookie', user.cookie).send({ events: many })).status).toBe(400);
  });

  it('attributes events to the caller, never to a claimed user', async () => {
    const one = await seedUser();
    const two = await seedUser();

    await request(app)
      .post('/telemetry')
      .set('Cookie', one.cookie)
      .send({ events: [{ event: 'card_shown', meta: { userId: two.id } }] });

    const rows = await db.select().from(clientEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(one.id);
  });

  it('requires a user', async () => {
    const res = await request(app).post('/telemetry').send({ events: [{ event: 'card_shown' }] });
    expect(res.status).toBe(401);
  });
});
