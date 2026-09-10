/**
 * `pnpm seed:session` — two users for the session-completion states
 * (E2E-004), no real generation required.
 *
 * `session.spec.ts`'s existing tests run against the shared `dev@learnos.local`
 * account and deliberately never click "Finish" — completing a session there
 * would insert a `sessionDays` row for *today*, and every subsequent run of
 * this whole suite on the same calendar day would find `completedToday: true`
 * and see "Done for today" instead of the in-progress session those tests
 * assert on. The three completion headings (`SessionPage.tsx`) need their own
 * disposable state instead:
 *
 *   - `empty`    — an active topic with zero concepts and zero due reviews,
 *     so `GET /session` returns nothing to do from the very first load
 *     ("Nothing due today"), and completing it (with nothing taught) is the
 *     cheapest way to reach "Done for today" on a reload afterward.
 *   - `withWork` — an active topic with exactly one ready, untaught,
 *     `try_first` concept and one `recall` item, so a real walk-through
 *     produces "That's today done" (`taught.length > 0`).
 *
 * Neither needs a due review or the FSRS scheduler: `didSomething` in
 * `SessionPage.tsx` is `taught.length > 0 || reviewed > 0`, so one taught
 * concept alone already exercises the interesting branch.
 *
 * Idempotent — keyed by the `e2e-session-` email prefix, wiped and recreated
 * every run, following `seedMatrix.ts`'s own FK-cleanup order.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, inArray, like } from 'drizzle-orm';
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

const PREFIX = 'e2e-session-';
const OUT_FILE = join(dirname(fileURLToPath(import.meta.url)), '../../../e2e/session-users.json');

async function wipeExisting(): Promise<void> {
  const staleUsers = await db.select({ id: users.id }).from(users).where(like(users.email, `${PREFIX}%`));
  for (const { id } of staleUsers) {
    const topicRows = await db.select({ id: topics.id }).from(topics).where(eq(topics.userId, id));
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
    await db.delete(topics).where(eq(topics.userId, id));

    await db.delete(dailyPulse).where(eq(dailyPulse.userId, id));
    await db.delete(clientEvents).where(eq(clientEvents.userId, id));
    await db.delete(authTokens).where(eq(authTokens.userId, id));
    await db.delete(oauthAccounts).where(eq(oauthAccounts.userId, id));
    await db.delete(sessions).where(eq(sessions.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }
}

async function seedUser(email: string) {
  const [user] = await db.insert(users).values({ email, name: null }).returning({ id: users.id });
  if (!user) throw new Error('seedSessionUsers: user insert returned no row');
  const session = await createSession(user.id, 'web');
  return { userId: user.id, webSessionToken: session.token };
}

async function seedEmptyTopic(email: string) {
  const user = await seedUser(email);
  const [topic] = await db
    .insert(topics)
    .values({ userId: user.userId, title: 'Dynamic programming', status: 'active' })
    .returning({ id: topics.id });
  if (!topic) throw new Error('seedSessionUsers: topic insert returned no row');
  return { ...user, topicId: topic.id };
}

async function seedTopicWithOneReadyConcept(email: string) {
  const user = await seedUser(email);
  const [topic] = await db
    .insert(topics)
    .values({ userId: user.userId, title: 'Dynamic programming', status: 'active' })
    .returning({ id: topics.id });
  if (!topic) throw new Error('seedSessionUsers: topic insert returned no row');

  const [concept] = await db
    .insert(concepts)
    .values({
      topicId: topic.id,
      slug: 'memoization',
      title: 'Memoization',
      order: 1,
      heldOut: false,
      teachMode: 'try_first',
      tryFirstPrompt: 'A function re-computes the same result on every call. What would you cache?',
      explanationShort: 'Store a result the first time it is computed, keyed by its input, and reuse it.',
      explanationLong:
        'Store a result the first time it is computed, keyed by its input, and reuse it on later calls with the same input instead of recomputing.',
      corrections: [],
    })
    .returning({ id: concepts.id });
  if (!concept) throw new Error('seedSessionUsers: concept insert returned no row');

  await db.insert(items).values({
    conceptId: concept.id,
    type: 'recall',
    payload: { type: 'recall', prompt: 'What do you call storing a computed result for reuse?', answer: 'memoization', accept: [] },
    isTransfer: false,
  });

  return { ...user, topicId: topic.id };
}

/**
 * Five independent (no-prereq) concepts, alternating `try_first`/
 * `example_first` by order — same convention `seed.ts`'s own dev topic uses.
 * With `endsAt` left null, `planSession` (`lib/planner.ts`) falls back to
 * `MAX_NEW_CONCEPTS` for its pace rather than dividing by a remaining-days of
 * zero, so this reliably offers exactly 3 of the 5 ready concepts — enough to
 * exercise the daily cap and guarantee at least one `example_first` among
 * them, neither of which the real, prereq-chained dev topic can promise on
 * any given day (only whichever single concept happens to be next).
 */
async function seedTopicWithManyReadyConcepts(email: string) {
  const user = await seedUser(email);
  const [topic] = await db
    .insert(topics)
    .values({ userId: user.userId, title: 'Dynamic programming', status: 'active' })
    .returning({ id: topics.id });
  if (!topic) throw new Error('seedSessionUsers: topic insert returned no row');

  const rows = await db
    .insert(concepts)
    .values(
      Array.from({ length: 5 }, (_, i) => ({
        topicId: topic.id,
        slug: `c${i + 1}`,
        title: `Concept ${i + 1}`,
        order: i + 1,
        heldOut: false,
        teachMode: (i % 2 === 0 ? 'try_first' : 'example_first') as 'try_first' | 'example_first',
        tryFirstPrompt: `What do you think Concept ${i + 1} means, before reading on?`,
        explanationShort: `Concept ${i + 1}, explained in a sentence.`,
        explanationLong: `Concept ${i + 1}, explained at more length for anyone who wants it.`,
        corrections: [],
      })),
    )
    .returning({ id: concepts.id });

  await db.insert(items).values(
    rows.map((r, i) => ({
      conceptId: r.id,
      type: 'recall' as const,
      payload: { type: 'recall', prompt: `Recall check for Concept ${i + 1}`, answer: 'the answer', accept: [] },
      isTransfer: false,
    })),
  );

  return { ...user, topicId: topic.id };
}

async function main(): Promise<void> {
  if (!isLocalDatabase(env.DATABASE_URL) && process.env.SEED_FORCE !== '1') {
    console.error(`seedSessionUsers: refusing to run against ${new URL(env.DATABASE_URL).hostname}.`);
    process.exit(1);
  }

  await wipeExisting();

  const empty = await seedEmptyTopic(`${PREFIX}empty@learnos.local`);
  const withWork = await seedTopicWithOneReadyConcept(`${PREFIX}withwork@learnos.local`);
  const manyReady = await seedTopicWithManyReadyConcepts(`${PREFIX}manyready@learnos.local`);

  writeFileSync(OUT_FILE, JSON.stringify({ empty, withWork, manyReady }, null, 2));
  console.log(`seedSessionUsers: empty topic ${empty.topicId}, withWork topic ${withWork.topicId}`);
  console.log(`seedSessionUsers: manyReady topic ${manyReady.topicId}`);
  console.log(`seedSessionUsers: written to ${OUT_FILE}`);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  await main();
  await pg.end();
}
