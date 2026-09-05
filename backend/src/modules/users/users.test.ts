import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
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
