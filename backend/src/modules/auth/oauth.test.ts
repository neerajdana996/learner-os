import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../app.js';
import { db } from '../../db/client.js';
import { oauthAccounts, sessions, users } from '../../db/schema.js';
import { truncateAll } from '../../test/db.js';

/** `seedUser` logs the user in; tests that count sessions need one without. */
async function seedBareUser(email: string, name?: string) {
  const [user] = await db.insert(users).values({ email, name }).returning();
  if (!user) throw new Error('user insert returned no row');
  return user;
}

const app = createApp();

/**
 * Provider HTTP is stubbed at `fetch` — the flows never touch Google or GitHub
 * in tests (loop.md §3). Each entry is matched by URL substring.
 */
const routes = new Map<string, () => { ok: boolean; status?: number; body: unknown }>();
const realFetch = globalThis.fetch;

function stub(match: string, body: unknown, ok = true, status = 200) {
  routes.set(match, () => ({ ok, status, body }));
}

beforeEach(async () => {
  await truncateAll();
  routes.clear();
  globalThis.fetch = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    for (const [match, make] of routes) {
      if (url.includes(match)) {
        const { ok, status, body } = make();
        return new Response(JSON.stringify(body), {
          status: status ?? (ok ? 200 : 400),
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    throw new Error(`unstubbed fetch to ${url}`);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Drives start → callback, carrying the state cookie the way a browser would. */
async function signIn(provider: 'google' | 'github', code = 'the-code') {
  const start = await request(app).get(`/auth/oauth/${provider}/start`);
  const stateCookie = start.headers['set-cookie']?.[0] ?? '';
  const state = /learnos_oauth_state=([^;]+)/.exec(stateCookie)?.[1] ?? '';
  return request(app)
    .get(`/auth/oauth/${provider}/callback`)
    .query({ code, state: decodeURIComponent(state) })
    .set('Cookie', stateCookie);
}

function stubGoogle(opts: { sub?: string; email?: string; verified?: boolean; name?: string } = {}) {
  stub('oauth2.googleapis.com/token', { access_token: 'tok' });
  stub('openidconnect.googleapis.com/v1/userinfo', {
    sub: opts.sub ?? 'google-123',
    email: opts.email ?? 'alice@example.com',
    email_verified: opts.verified ?? true,
    name: opts.name ?? 'Alice',
  });
}

function stubGithub(opts: { id?: number; email?: string; verified?: boolean; name?: string } = {}) {
  stub('github.com/login/oauth/access_token', { access_token: 'tok' });
  stub('api.github.com/user/emails', [
    { email: opts.email ?? 'alice@example.com', primary: true, verified: opts.verified ?? true },
  ]);
  stub('api.github.com/user', { id: opts.id ?? 456, name: opts.name ?? 'Alice', login: 'alice' });
}

describe('OAuth start', () => {
  it('redirects to the provider and sets a state cookie', async () => {
    const res = await request(app).get('/auth/oauth/google/start');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('accounts.google.com');
    expect(res.headers['set-cookie']?.[0]).toContain('learnos_oauth_state');
    expect(res.headers['set-cookie']?.[0]).toContain('HttpOnly');
  });

  it('404s an unknown provider', async () => {
    expect((await request(app).get('/auth/oauth/facebook/start')).status).toBe(404);
  });
});

describe('OAuth callback', () => {
  it('creates a user and a session for a new verified Google identity', async () => {
    stubGoogle();
    const res = await signIn('google');

    expect(res.status).toBe(302);
    // Search all Set-Cookie headers: the state cookie is cleared first, so the
    // session is not at index 0.
    expect(String(res.headers['set-cookie'] ?? '')).toContain('learnos_session');

    const [user] = await db.select().from(users).where(eq(users.email, 'alice@example.com'));
    expect(user?.name).toBe('Alice');
    expect(await db.select().from(oauthAccounts)).toHaveLength(1);
    expect(await db.select().from(sessions)).toHaveLength(1);
  });

  it('links to the existing account when a magic-link user signs in with Google', async () => {
    const existing = await seedBareUser('alice@example.com', 'Alice');
    stubGoogle();

    await signIn('google');

    // One human, one row — not a duplicate account.
    expect(await db.select().from(users)).toHaveLength(1);
    const links = await db.select().from(oauthAccounts);
    expect(links).toHaveLength(1);
    expect(links[0]?.userId).toBe(existing.id);
  });

  it('resolves Google and GitHub for one verified address to a single user', async () => {
    stubGoogle();
    await signIn('google');
    stubGithub();
    await signIn('github');

    expect(await db.select().from(users)).toHaveLength(1);
    const links = await db.select().from(oauthAccounts);
    expect(links.map((l) => l.provider).sort()).toEqual(['github', 'google']);
    expect(new Set(links.map((l) => l.userId)).size).toBe(1);
  });

  it('refuses an unverified GitHub email rather than linking it', async () => {
    await seedBareUser('victim@example.com');
    stubGithub({ email: 'victim@example.com', verified: false });

    const res = await signIn('github');

    // The takeover path: anyone can type any address onto a GitHub profile, so
    // an unverified address must never reach an existing account.
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_verified_email');
    expect(await db.select().from(oauthAccounts)).toHaveLength(0);
    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  it('refuses an unverified Google email', async () => {
    await seedBareUser('victim@example.com');
    stubGoogle({ email: 'victim@example.com', verified: false });

    const res = await signIn('google');

    expect(res.status).toBe(400);
    expect(await db.select().from(oauthAccounts)).toHaveLength(0);
  });

  it('keeps working after the provider email changes, because identity is the subject id', async () => {
    stubGoogle({ sub: 'google-123', email: 'alice@example.com' });
    await signIn('google');

    stubGoogle({ sub: 'google-123', email: 'alice-new@example.com' });
    await signIn('google');

    // Same subject id, so the same account — not a second user for the new address.
    expect(await db.select().from(users)).toHaveLength(1);
    expect(await db.select().from(oauthAccounts)).toHaveLength(1);
  });

  it('rejects a mismatched state', async () => {
    stubGoogle();
    const start = await request(app).get('/auth/oauth/google/start');

    const res = await request(app)
      .get('/auth/oauth/google/callback')
      .query({ code: 'c', state: 'attacker-supplied' })
      .set('Cookie', start.headers['set-cookie']?.[0] ?? '');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad_state');
    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  it('rejects a callback with no state cookie at all', async () => {
    stubGoogle();
    const res = await request(app).get('/auth/oauth/google/callback').query({ code: 'c', state: 's' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad_state');
  });

  it('rejects a callback with no code', async () => {
    const start = await request(app).get('/auth/oauth/google/start');
    const cookie = start.headers['set-cookie']?.[0] ?? '';
    const state = decodeURIComponent(/learnos_oauth_state=([^;]+)/.exec(cookie)?.[1] ?? '');

    const res = await request(app)
      .get('/auth/oauth/google/callback')
      .query({ state })
      .set('Cookie', cookie);

    expect(res.status).toBe(400);
  });

  it('surfaces a failed token exchange without creating anything', async () => {
    stub('oauth2.googleapis.com/token', { error: 'bad_verification_code' }, false, 401);
    const res = await signIn('google');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('exchange_failed');
    expect(await db.select().from(users)).toHaveLength(0);
    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  it('does not overwrite a name the learner set during onboarding', async () => {
    const existing = await seedBareUser('alice@example.com', 'Neeraj');
    stubGoogle({ name: 'Alice' });

    await signIn('google');

    const [user] = await db.select().from(users).where(eq(users.id, existing.id));
    expect(user?.name).toBe('Neeraj');
  });

  it('issues a session that authenticates a subsequent request', async () => {
    stubGoogle();
    const res = await signIn('google');
    const setCookie = res.headers['set-cookie'] ?? [];
    const cookie = (Array.isArray(setCookie) ? setCookie : [setCookie]).find((c) =>
      c.startsWith('learnos_session'),
    ) ?? '';

    const me = await request(app).get('/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('alice@example.com');
  });
});
