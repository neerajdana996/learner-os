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
import { resetAuthRateLimits } from './auth.rateLimit.js';
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
  // Counters live in module state, so they carry between tests in one process.
  resetAuthRateLimits();
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

describe('POST /auth/magic rate limiting (T-FIX-007)', () => {
  const magic = (email: string) => request(app).post('/auth/magic').send({ email });

  it('refuses a fourth request for the same address in the window', async () => {
    for (let i = 0; i < 3; i += 1) expect((await magic('spam@example.com')).status).toBe(200);

    const fourth = await magic('spam@example.com');
    expect(fourth.status).toBe(429);
    // The point of the limit is that no further mail goes out.
    expect(sent).toHaveLength(3);
  });

  it('writes no token row for a refused request', async () => {
    for (let i = 0; i < 3; i += 1) await magic('spam@example.com');
    const before = (await db.select().from(authTokens)).length;

    await magic('spam@example.com');

    expect(await db.select().from(authTokens)).toHaveLength(before);
  });

  it('limits per address, so one spammed inbox does not lock out others', async () => {
    for (let i = 0; i < 3; i += 1) await magic('spam@example.com');
    expect((await magic('spam@example.com')).status).toBe(429);

    expect((await magic('someone-else@example.com')).status).toBe(200);
  });

  it('counts normalised addresses as one bucket', async () => {
    // Casing and padding must not buy a fresh budget — the limiter runs after
    // validation for exactly this reason.
    await magic('spam@example.com');
    await magic('SPAM@example.com');
    await magic('  spam@EXAMPLE.com  ');

    expect((await magic('spam@example.com')).status).toBe(429);
  });

  it('refuses an unknown address the same way, staying no account oracle', async () => {
    for (let i = 0; i < 3; i += 1) await magic('nobody@example.com');
    const refused = await magic('nobody@example.com');

    expect(refused.status).toBe(429);
    expect(refused.body).toEqual({ error: 'rate_limited' });
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

  it('invalidates the previous link when a new one is requested', async () => {
    const first = await requestLink();
    const second = await requestLink();

    // Only the newest link works — otherwise repeated requests leave a growing
    // set of live links, and "send it again" would not mean what it says.
    expect((await request(app).get('/auth/verify').query({ token: first })).status).toBe(401);
    expect((await request(app).get('/auth/verify').query({ token: second })).status).toBe(302);
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

describe('POST /auth/dev-login', () => {
  it('signs in with the dev credentials and sets a real session cookie', async () => {
    const res = await request(app)
      .post('/auth/dev-login')
      .send({ email: 'dev@learnos.local', password: 'learnos' });

    expect(res.status).toBe(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0] ?? '';
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toContain('HttpOnly');

    // A real session row, not a special case the rest of the app has to know
    // about — every downstream route treats it like any other sign-in.
    const rows = await db.select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('web');

    const me = await request(app).get('/me').set('Cookie', cookie.split(';')[0] ?? '');
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('dev@learnos.local');
  });

  it('creates the dev user on first use, and reuses it afterwards', async () => {
    await request(app).post('/auth/dev-login').send({ email: 'dev@learnos.local', password: 'learnos' });
    await request(app).post('/auth/dev-login').send({ email: 'dev@learnos.local', password: 'learnos' });

    const rows = await db.select().from(users).where(eq(users.email, 'dev@learnos.local'));
    expect(rows).toHaveLength(1);
  });

  it('rejects the wrong password and any other address', async () => {
    const wrongPassword = await request(app)
      .post('/auth/dev-login')
      .send({ email: 'dev@learnos.local', password: 'nope' });
    expect(wrongPassword.status).toBe(401);

    const wrongEmail = await request(app)
      .post('/auth/dev-login')
      .send({ email: 'someone@example.com', password: 'learnos' });
    expect(wrongEmail.status).toBe(401);

    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  it('is not rate limited — three sign-ins in an afternoon is normal', async () => {
    // /auth/magic allows 3 per address per 15 minutes because it mails a
    // stranger. Sharing that budget here would lock a developer out.
    for (let i = 0; i < 5; i += 1) {
      const res = await request(app)
        .post('/auth/dev-login')
        .send({ email: 'dev@learnos.local', password: 'learnos' });
      expect(res.status).toBe(200);
    }
  });

  it('does not exist at all under NODE_ENV=production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const { createApp: createProdApp } = await import('../../app.js');

    const res = await request(createProdApp())
      .post('/auth/dev-login')
      .send({ email: 'dev@learnos.local', password: 'learnos' });

    // 404, not 401: the route is never registered, so a misconfigured secret or
    // a forgotten flag cannot turn it back on.
    expect(res.status).toBe(404);
    expect(await db.select().from(sessions)).toHaveLength(0);

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
