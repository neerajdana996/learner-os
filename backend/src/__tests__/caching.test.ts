import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { seedUser, truncateAll } from '../test/db.js';

const app = createApp();

describe('the API is never browser-cached (T-124)', () => {
  it('sends no ETag, so nothing becomes a conditional request', async () => {
    // Express weak-ETags JSON by default. The extension polls /me every five
    // minutes, which turned into a revalidation — and a response cached while
    // the extension's origin was still refused kept being revalidated after the
    // server was fixed, with no Access-Control-Allow-Origin on the stale entry.
    // The fetch went on failing against a backend answering 200.
    await truncateAll();
    const user = await seedUser();

    const res = await request(app).get('/me').set('Cookie', user.cookie);

    expect(res.status).toBe(200);
    expect(res.headers.etag).toBeUndefined();
  });

  it('marks every response no-store, because they are personal', async () => {
    // /me carries an email and a profile; /due carries the next question.
    // None of it belongs in a disk cache on a shared machine.
    await truncateAll();
    const user = await seedUser();

    const res = await request(app).get('/me').set('Cookie', user.cookie);

    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('marks an unauthenticated response no-store too', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
