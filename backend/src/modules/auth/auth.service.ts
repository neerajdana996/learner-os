import { env } from '../../lib/env.js';
import { getMailTransport } from '../../lib/mail.js';
import { hashToken, issueToken } from '../../lib/token.js';
import {
  consumeAuthToken,
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
