import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { authTokens, sessions, users } from '../../db/schema.js';

export async function findUserByEmail(email: string) {
  const [user] = await db.select().from(users).where(eq(users.email, email));
  return user ?? null;
}

export async function createUser(email: string) {
  const [user] = await db.insert(users).values({ email }).returning();
  if (!user) throw new Error('user insert returned no row');
  return user;
}

export async function insertAuthToken(values: { userId: string; token: string; expiresAt: Date }) {
  const [row] = await db.insert(authTokens).values(values).returning();
  if (!row) throw new Error('auth token insert returned no row');
  return row;
}

/** Only ever looked up by hash — the raw token is never stored (lib/token.ts). */
export async function findUnconsumedAuthToken(hash: string) {
  const [row] = await db
    .select()
    .from(authTokens)
    .where(and(eq(authTokens.token, hash), isNull(authTokens.consumedAt)));
  return row ?? null;
}

export async function consumeAuthToken(id: string, now: Date) {
  await db.update(authTokens).set({ consumedAt: now }).where(eq(authTokens.id, id));
}

/**
 * Spends every outstanding link for a user, so requesting a new one replaces
 * the old rather than leaving a growing set of working links (T-FIX-007).
 * Also what a learner expects after clicking "send it again".
 */
export async function consumePriorAuthTokens(userId: string, now: Date) {
  await db
    .update(authTokens)
    .set({ consumedAt: now })
    .where(and(eq(authTokens.userId, userId), isNull(authTokens.consumedAt)));
}

export async function insertSession(values: {
  userId: string;
  token: string;
  kind: 'web' | 'extension';
  expiresAt: Date;
}) {
  const [row] = await db.insert(sessions).values(values).returning();
  if (!row) throw new Error('session insert returned no row');
  return row;
}

export async function findActiveSession(hash: string) {
  const [row] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.token, hash), isNull(sessions.revokedAt)));
  return row ?? null;
}

export async function hasExtensionSession(userId: string) {
  const [row] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), eq(sessions.kind, 'extension'), isNull(sessions.revokedAt)));
  return row !== undefined;
}
