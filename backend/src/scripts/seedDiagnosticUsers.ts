/**
 * `pnpm seed:diagnostic` — two users each with a diagnostic-ready topic, no
 * generation required (E2E-003).
 *
 * The adaptive diagnostic (`backend/src/lib/diagnostic.ts`) only needs a
 * topic that is `active` with concepts, prereqs and one recall item each —
 * nothing about testing it requires that content to have come from a real
 * generation, and running one would cost minutes and money per E2E run. This
 * mirrors `diagnostic.test.ts`'s own `seedTopic()` helper, just as real
 * database rows outside the test harness rather than inside it.
 *
 * Two topics, both a straight-line chain of N concepts (concept i+1 depends
 * on concept i), each carrying one recall item whose answer this script
 * knows:
 *   - `early` (12 concepts) — few enough that answering every question the
 *     same way resolves the whole map before the 15-question ceiling
 *     (`MAX_QUESTIONS`), matching `diagnostic.test.ts`'s own "stops early"
 *     fixture size.
 *   - `caps`  (40 concepts) — enough that alternating answers cannot resolve
 *     the whole map, matching that file's own "caps at 15" fixture size.
 *
 * Each concept's item prompt names the concept ("Recall check for Concept
 * 3") rather than the backend test's generic "q", so an E2E test can tell
 * from the rendered page alone which concept is being asked — the `conceptId`
 * the API returns is never shown in the UI.
 *
 * Idempotent — keyed by the `e2e-diag-` email prefix, wiped and recreated
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

const PREFIX = 'e2e-diag-';
const OUT_FILE = join(dirname(fileURLToPath(import.meta.url)), '../../../e2e/diagnostic-users.json');

const FIXTURES = [
  { key: 'early', email: `${PREFIX}early@learnos.local`, count: 12 },
  { key: 'caps', email: `${PREFIX}caps@learnos.local`, count: 40 },
] as const;

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

async function seedChain(email: string, n: number) {
  const [user] = await db.insert(users).values({ email, name: null }).returning({ id: users.id });
  if (!user) throw new Error('seedDiagnosticUsers: user insert returned no row');

  const [topic] = await db
    .insert(topics)
    .values({ userId: user.id, title: 'Dynamic programming', status: 'active' })
    .returning({ id: topics.id });
  if (!topic) throw new Error('seedDiagnosticUsers: topic insert returned no row');

  const rows = await db
    .insert(concepts)
    .values(
      Array.from({ length: n }, (_, i) => ({
        topicId: topic.id,
        slug: `c${i + 1}`,
        title: `Concept ${i + 1}`,
        order: i + 1,
        heldOut: false,
        teachMode: 'try_first' as const,
      })),
    )
    .returning({ id: concepts.id, order: concepts.order });

  const byOrder = new Map(rows.map((r) => [r.order, r.id]));
  const edges = Array.from({ length: n - 1 }, (_, i) => ({
    conceptId: byOrder.get(i + 2) as string,
    prerequisiteConceptId: byOrder.get(i + 1) as string,
  }));
  if (edges.length > 0) await db.insert(conceptPrereqs).values(edges);

  await db.insert(items).values(
    rows.map((r) => ({
      conceptId: r.id,
      type: 'recall' as const,
      payload: {
        type: 'recall',
        prompt: `Recall check for Concept ${r.order}`,
        answer: 'the answer',
        accept: [],
      },
      isTransfer: false,
    })),
  );

  const session = await createSession(user.id, 'web');
  return { userId: user.id, webSessionToken: session.token, topicId: topic.id };
}

async function main(): Promise<void> {
  if (!isLocalDatabase(env.DATABASE_URL) && process.env.SEED_FORCE !== '1') {
    console.error(`seedDiagnosticUsers: refusing to run against ${new URL(env.DATABASE_URL).hostname}.`);
    process.exit(1);
  }

  await wipeExisting();

  const output: Record<string, { userId: string; webSessionToken: string; topicId: string }> = {};
  for (const { key, email, count } of FIXTURES) {
    output[key] = await seedChain(email, count);
    console.log(`seedDiagnosticUsers: ${key} — ${email}, ${count} concepts, topic ${output[key]!.topicId}`);
  }

  writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
  console.log(`seedDiagnosticUsers: written to ${OUT_FILE}`);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  await main();
  await pg.end();
}
