import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../app.js';
import { db } from '../../db/client.js';
import { authTokens, sessions } from '../../db/schema.js';
import { consoleTransport, setMailTransport, type Mail } from '../../lib/mail.js';
import { issueToken } from '../../lib/token.js';
import { loginAs, seedUser, truncateAll } from '../../test/db.js';
import { SESSION_COOKIE } from './cookie.js';
import { users } from '../../db/schema.js';

const app = createApp();

/** `seedUser` logs the user in; these tests count sessions, so they need one
 *  that hasn't got a session yet. */
async function seedBareUser(email = `bare-${Math.random().toString(36).slice(2)}@example.com`) {
  const [user] = await db.insert(users).values({ email }).returning();
  if (!user) throw new Error('user insert returned no row');
  return user;
}

const sent: Mail[] = [];

/** The link is the only place the raw token exists — same as for a real user. */
function tokenFromLastMail(): string {
  const mail = sent.at(-1);
  if (!mail) throw new Error('no mail was sent');
  const match = /token=([^\s]+)/.exec(mail.text);
  if (!match?.[1]) throw new Error(`no token in mail: ${mail.text}`);
  return decodeURIComponent(match[1]);
}

beforeEach(async () => {
  await truncateAll();
  sent.length = 0;
  setMailTransport({
    async send(mail) {
      sent.push(mail);
    },
  });
});

afterEach(() => {
  setMailTransport(consoleTransport);
  vi.unstubAllEnvs();
});

describe('POST /auth/magic', () => {
  it('creates the user, stores a token, and mails a link', async () => {
    const res = await request(app).post('/auth/magic').send({ email: 'new@example.com' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(await db.select().from(authTokens)).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('new@example.com');
  });

  it('answers identically for a known and an unknown address', async () => {
    await seedUser({ email: 'known@example.com' });

    const known = await request(app).post('/auth/magic').send({ email: 'known@example.com' });
    const unknown = await request(app).post('/auth/magic').send({ email: 'nobody@example.com' });

    // Any difference here would turn this route into an account-existence oracle.
    expect(known.status).toBe(unknown.status);
    expect(known.body).toEqual(unknown.body);
  });

  it('does not create a second user for an existing address', async () => {
    await seedUser({ email: 'known@example.com' });
    await request(app).post('/auth/magic').send({ email: 'known@example.com' });

    const tokens = await db.select().from(authTokens);
    expect(tokens).toHaveLength(1);
  });

  it('normalises the email so casing and padding do not fork the account', async () => {
    await request(app).post('/auth/magic').send({ email: '  Mixed@Example.COM ' });
    expect(sent[0]?.to).toBe('mixed@example.com');
  });

  it('rejects a malformed email', async () => {
    const res = await request(app).post('/auth/magic').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(await db.select().from(authTokens)).toHaveLength(0);
  });

  it('stores only a hash — the raw token from the link is never in the database', async () => {
    await request(app).post('/auth/magic').send({ email: 'new@example.com' });
    const raw = tokenFromLastMail();

    const [row] = await db.select().from(authTokens);
    expect(row?.token).toBeDefined();
    expect(row?.token).not.toBe(raw);
  });
});

describe('GET /auth/verify', () => {
  async function requestLink(email = 'new@example.com') {
    await request(app).post('/auth/magic').send({ email });
    return tokenFromLastMail();
  }

  it('sets a session cookie and creates a session row', async () => {
    const raw = await requestLink();
    const res = await request(app).get('/auth/verify').query({ token: raw });

    expect(res.status).toBe(302);
    const cookie = res.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toContain(SESSION_COOKIE);
    expect(cookie).toContain('HttpOnly');
    expect(await db.select().from(sessions)).toHaveLength(1);
  });

  it('rejects a token replayed a second time', async () => {
    const raw = await requestLink();
    await request(app).get('/auth/verify').query({ token: raw });

    const replay = await request(app).get('/auth/verify').query({ token: raw });
    expect(replay.status).toBe(401);
    expect(await db.select().from(sessions)).toHaveLength(1);
  });

  it('rejects an expired token', async () => {
    const user = await seedBareUser();
    const { raw, hash } = issueToken();
    await db.insert(authTokens).values({
      userId: user.id,
      token: hash,
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await request(app).get('/auth/verify').query({ token: raw });
    expect(res.status).toBe(401);
    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  it('rejects an unknown token', async () => {
    const res = await request(app).get('/auth/verify').query({ token: 'not-a-real-token' });
    expect(res.status).toBe(401);
  });

  it('issues a session whose stored token is a hash, not the cookie value', async () => {
    const raw = await requestLink();
    const res = await request(app).get('/auth/verify').query({ token: raw });
    const cookie = res.headers['set-cookie']?.[0] ?? '';
    const value = /learnos_session=([^;]+)/.exec(cookie)?.[1] ?? '';

    const [row] = await db.select().from(sessions);
    expect(value).not.toBe('');
    expect(row?.token).not.toBe(decodeURIComponent(value));
  });
});

describe('requireUser', () => {
  it('accepts a session cookie', async () => {
    const user = await seedUser();
    const { cookie } = await loginAs(user.id);

    const res = await request(app).get('/topics').set('Cookie', cookie);
    expect(res.status).toBe(200);
  });

  it('accepts a bearer extension token on /due', async () => {
    const user = await seedUser();
    const { bearer } = await loginAs(user.id, 'extension');

    const res = await request(app).get('/due?limit=5').set('Authorization', bearer);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
  });

  it('rejects a revoked session', async () => {
    const user = await seedUser();
    const { cookie } = await loginAs(user.id);
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, user.id));

    const res = await request(app).get('/topics').set('Cookie', cookie);
    expect(res.status).toBe(401);
  });

  it('rejects an expired session', async () => {
    const user = await seedUser();
    const { cookie } = await loginAs(user.id);
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.userId, user.id));

    const res = await request(app).get('/topics').set('Cookie', cookie);
    expect(res.status).toBe(401);
  });

  it('rejects a garbage cookie', async () => {
    const res = await request(app).get('/topics').set('Cookie', `${SESSION_COOKIE}=nonsense`);
    expect(res.status).toBe(401);
  });

  it('rejects a request with no credentials at all', async () => {
    const res = await request(app).get('/topics');
    expect(res.status).toBe(401);
  });

  it('still accepts x-user-id outside production', async () => {
    const user = await seedUser();
    const res = await request(app).get('/topics').set('x-user-id', user.id);
    expect(res.status).toBe(200);
  });

  it('rejects x-user-id under NODE_ENV=production', async () => {
    const user = await seedUser();

    // env.ts parses process.env at import time, so the guard can only be
    // exercised by rebuilding the module graph with NODE_ENV already set.
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const { createApp: createProdApp } = await import('../../app.js');
    const prodApp = createProdApp();

    const res = await request(prodApp).get('/topics').set('x-user-id', user.id);
    expect(res.status).toBe(401);

    vi.unstubAllEnvs();
    vi.resetModules();
  });
});

describe('POST /auth/extension-token', () => {
  it('returns a bearer token for an authenticated web session', async () => {
    const user = await seedUser();
    const { cookie } = await loginAs(user.id);

    const res = await request(app).post('/auth/extension-token').set('Cookie', cookie);

    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe('string');
    const rows = await db.select().from(sessions).where(eq(sessions.kind, 'extension'));
    expect(rows).toHaveLength(1);
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/auth/extension-token');
    expect(res.status).toBe(401);
  });
});
