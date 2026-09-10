/**
 * `pnpm seed:fresh` — a genuinely new, topic-less user (E2E-002).
 *
 * The onboarding E2E spec needs to exercise "a brand-new signed-in learner
 * lands on `/onboarding`" and walk the whole five-step form to a real
 * `POST /topics`. Doing that against `dev@learnos.local` would mean either
 * destructively resetting the shared dev account's topics (breaking every
 * other spec file that assumes it has a taught topic — Playwright runs this
 * project's files in one worker, sequentially, so the damage would outlive
 * this file) or accepting file-ordering as a hidden dependency. Neither is
 * worth it when a second throwaway user is this cheap.
 *
 * Mirrors `seedMatrix.ts`'s pattern exactly: create a user, mint a *web*
 * session (`POST /auth/dev-login` only ever authenticates the one fixed dev
 * account, so this is the only way to sign in as anyone else), and write the
 * token to a file the Playwright spec reads and injects as a cookie.
 * Idempotent — keyed by a fixed email, deleted and recreated every run.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, inArray } from 'drizzle-orm';
import { db, pg } from '../db/client.js';
import {
  authTokens,
  cards,
  clientEvents,
  conceptPrereqs,
  concepts,
  dailyPulse,
  items,
  oauthAccounts,
  reviewEvents,
  sessionDays,
  sessions,
  tests,
  topics,
  users,
} from '../db/schema.js';
import { env } from '../lib/env.js';
import { createSession } from '../modules/auth/auth.service.js';
import { isLocalDatabase } from './seed.js';

const EMAIL = 'e2e-fresh@learnos.local';
const OUT_FILE = join(dirname(fileURLToPath(import.meta.url)), '../../../e2e/fresh-user.json');

async function main(): Promise<void> {
  if (!isLocalDatabase(env.DATABASE_URL) && process.env.SEED_FORCE !== '1') {
    console.error(`seedFreshUser: refusing to run against ${new URL(env.DATABASE_URL).hostname}.`);
    process.exit(1);
  }

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, EMAIL));
  if (existing) {
    // This user starts each run topic-less, but the onboarding E2E spec's own
    // "submitting" tests genuinely click "Build my map" against it, so a
    // second run has to tear down whatever topic tree that left behind —
    // mirroring seedMatrix.ts's own wipeMatrix, found the same hard way (a
    // topics_user_id_users_id_fk violation on the user delete below).
    const topicRows = await db.select({ id: topics.id }).from(topics).where(eq(topics.userId, existing.id));
    for (const { id: topicId } of topicRows) {
      const conceptIds = (
        await db.select({ id: concepts.id }).from(concepts).where(eq(concepts.topicId, topicId))
      ).map((r) => r.id);
      if (conceptIds.length > 0) {
        await db.delete(reviewEvents).where(inArray(reviewEvents.conceptId, conceptIds));
        await db.delete(cards).where(inArray(cards.conceptId, conceptIds));
        await db.delete(items).where(inArray(items.conceptId, conceptIds));
        await db.delete(conceptPrereqs).where(inArray(conceptPrereqs.conceptId, conceptIds));
      }
      await db.delete(sessionDays).where(eq(sessionDays.topicId, topicId));
      await db.delete(tests).where(eq(tests.topicId, topicId));
      await db.delete(concepts).where(eq(concepts.topicId, topicId));
    }
    await db.delete(topics).where(eq(topics.userId, existing.id));

    await db.delete(dailyPulse).where(eq(dailyPulse.userId, existing.id));
    await db.delete(clientEvents).where(eq(clientEvents.userId, existing.id));
    await db.delete(authTokens).where(eq(authTokens.userId, existing.id));
    await db.delete(oauthAccounts).where(eq(oauthAccounts.userId, existing.id));
    await db.delete(sessions).where(eq(sessions.userId, existing.id));
    await db.delete(users).where(eq(users.id, existing.id));
  }

  const [user] = await db.insert(users).values({ email: EMAIL, name: null }).returning();
  if (!user) throw new Error('seedFreshUser: insert returned no row');

  const session = await createSession(user.id, 'web');
  writeFileSync(OUT_FILE, JSON.stringify({ userId: user.id, webSessionToken: session.token }, null, 2));
  console.log(`seedFreshUser: ${EMAIL} (${user.id}), token written to ${OUT_FILE}`);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  await main();
  await pg.end();
}
