import { env, isProd } from '../../lib/env.js';
import { getMailTransport } from '../../lib/mail.js';
import { hashToken, issueToken } from '../../lib/token.js';
import {
  consumeAuthToken,
  consumePriorAuthTokens,
  createUser,
  findActiveSession,
  findUnconsumedAuthToken,
  findUserByEmail,
  insertAuthToken,
  insertSession,
} from './auth.repository.js';

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

/**
 * Creates the user on first sight, then mails them a single-use link.
 *
 * Returns nothing about whether the address was already registered: the route
 * answers identically either way, so this cannot be used to enumerate accounts.
 */
export async function requestMagicLink(email: string, now: Date = new Date()): Promise<void> {
  const user = (await findUserByEmail(email)) ?? (await createUser(email));
  const { raw, hash } = issueToken();

  // Only the newest link works. Prevents an unbounded set of live links from
  // repeated requests, and matches what "send it again" implies.
  await consumePriorAuthTokens(user.id, now);

  await insertAuthToken({
    userId: user.id,
    token: hash,
    expiresAt: new Date(now.getTime() + env.AUTH_TOKEN_TTL_MIN * MIN_MS),
  });

  const link = `${env.APP_URL}/auth/verify?token=${encodeURIComponent(raw)}`;
  await getMailTransport().send({
    to: email,
    subject: 'Your learnos sign-in link',
    text: `Sign in: ${link}\n\nThis link works once and expires in ${env.AUTH_TOKEN_TTL_MIN} minutes.`,
  });
}

/**
 * Exchanges a magic-link token for a session. Returns null for anything that
 * isn't a live, unconsumed, unexpired token — the caller must not distinguish
 * between the cases.
 */
export async function verifyMagicLink(raw: string, now: Date = new Date()): Promise<IssuedSession | null> {
  const row = await findUnconsumedAuthToken(hashToken(raw));
  if (!row || row.expiresAt <= now) return null;

  await consumeAuthToken(row.id, now);
  return createSession(row.userId, 'web', now);
}

export async function createSession(
  userId: string,
  kind: 'web' | 'extension',
  now: Date = new Date(),
): Promise<IssuedSession> {
  const { raw, hash } = issueToken();
  const expiresAt = new Date(now.getTime() + env.SESSION_TTL_DAYS * DAY_MS);
  await insertSession({ userId, token: hash, kind, expiresAt });
  return { token: raw, expiresAt };
}

/** Resolves a raw cookie/bearer value to a user id, or null. */
export async function resolveSession(raw: string, now: Date = new Date()): Promise<string | null> {
  const row = await findActiveSession(hashToken(raw));
  if (!row || row.expiresAt <= now) return null;
  return row.userId;
}

/**
 * Dev-only password sign-in (T-070).
 *
 * The route that calls this is **not mounted** under `NODE_ENV=production`, so
 * this function cannot be reached there at all — the check below is the second
 * lock, not the first. It exists because the real sign-in paths (magic link,
 * OAuth) both need something outside the app: a mail round trip or a provider
 * redirect, neither of which a developer wants twenty times a day.
 *
 * The credential is a plain comparison against `DEV_LOGIN_PASSWORD`. There is
 * deliberately no hashing, no lockout and no reset flow, because this is not an
 * authentication feature — treating it like one would invite someone to reach
 * for it in production. The user is created on first use, like the magic link
 * does, so a fresh database needs no seeding first.
 */
export async function devLogin(
  email: string,
  password: string,
  now: Date = new Date(),
): Promise<IssuedSession | null> {
  if (isProd) return null;
  if (email !== env.DEV_LOGIN_EMAIL || password !== env.DEV_LOGIN_PASSWORD) return null;

  const user = (await findUserByEmail(email)) ?? (await createUser(email));
  return createSession(user.id, 'web', now);
}
