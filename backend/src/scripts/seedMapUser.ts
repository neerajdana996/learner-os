/**
 * `pnpm seed:map` — a topic with all four `ConceptState`s and an `atRisk`
 * concept, all at once (E2E-005).
 *
 * `pnpm seed`'s own dev topic never produces a `known` concept: `known`
 * requires both `cards.taughtAt` set *and* a high diagnostic estimate
 * (`backend/src/lib/score.ts`), and `seed.ts` never writes
 * `topics.diagnosticState` at all. Building `known` (and controlling exactly
 * which concept is `atRisk`) needs its own small fixture rather than reading
 * whatever the dev topic's FSRS math happens to produce today.
 *
 * Five concepts, one per interesting state:
 *   - `heldout`           — `concepts.heldOut = true`.
 *   - `untaught`          — no card at all.
 *   - `taught` (solid)    — a card taught and reviewed well; not at risk.
 *   - `taught` (atRisk)   — a card taught but rated `Again` recently, the
 *     same technique `seed.ts` itself uses for its one at-risk concept.
 *   - `known`             — a taught card *plus* a high diagnostic estimate
 *     on `topics.diagnosticState.estimates` (mirrors the shape
 *     `backend/src/lib/diagnostic.ts`'s own `resolve()` writes).
 *
 * Idempotent — keyed by a fixed email, wiped and recreated every run.
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
import { newCard, Rating, scheduleReview, toDbCard, type Grade } from '../scheduler/index.js';
import { isLocalDatabase } from './seed.js';

const EMAIL = 'e2e-map@learnos.local';
const OUT_FILE = join(dirname(fileURLToPath(import.meta.url)), '../../../e2e/map-user.json');
const DAY = 86_400_000;

async function wipeExisting(): Promise<void> {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, EMAIL));
  if (!existing) return;

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

async function main(): Promise<void> {
  if (!isLocalDatabase(env.DATABASE_URL) && process.env.SEED_FORCE !== '1') {
    console.error(`seedMapUser: refusing to run against ${new URL(env.DATABASE_URL).hostname}.`);
    process.exit(1);
  }

  await wipeExisting();

  const [userRow] = await db.insert(users).values({ email: EMAIL, name: null }).returning({ id: users.id });
  if (!userRow) throw new Error('seedMapUser: user insert returned no row');
  const userId = userRow.id;

  const [topic] = await db
    .insert(topics)
    .values({ userId, title: 'Dynamic programming', status: 'active' })
    .returning({ id: topics.id });
  if (!topic) throw new Error('seedMapUser: topic insert returned no row');

  const now = new Date();
  const spec = [
    { slug: 'heldout', title: 'Held-out concept', heldOut: true },
    { slug: 'untaught', title: 'Untaught concept', heldOut: false },
    { slug: 'solid', title: 'Solid concept', heldOut: false },
    { slug: 'slipping', title: 'Slipping concept', heldOut: false },
    { slug: 'known', title: 'Known concept', heldOut: false },
  ];

  const inserted = await db
    .insert(concepts)
    .values(
      spec.map((s, i) => ({
        topicId: topic.id,
        slug: s.slug,
        title: s.title,
        order: i + 1,
        heldOut: s.heldOut,
        teachMode: 'try_first' as const,
        tryFirstPrompt: s.heldOut ? null : `What comes to mind for ${s.title}?`,
        explanationShort: s.heldOut ? null : `${s.title}, explained briefly.`,
        explanationLong: s.heldOut ? null : `${s.title}, explained at more length.`,
        corrections: [],
      })),
    )
    .returning({ id: concepts.id, slug: concepts.slug });
  const idBySlug = new Map(inserted.map((r) => [r.slug, r.id]));

  await db.insert(items).values(
    inserted
      .filter((r) => r.slug !== 'heldout')
      .map((r) => ({
        conceptId: r.id,
        type: 'recall' as const,
        payload: { type: 'recall', prompt: `Recall check for ${r.slug}`, answer: 'the answer', accept: [] },
        isTransfer: false,
      })),
  );

  function taughtCard(conceptId: string, rating: Grade, reviewedDaysAgo = 3) {
    const taughtAt = new Date(now.getTime() - 4 * DAY);
    const reviewedAt = new Date(now.getTime() - reviewedDaysAgo * DAY);
    const reviewed = scheduleReview(newCard(taughtAt), rating, reviewedAt);
    return { userId, conceptId, ...toDbCard(reviewed), taughtAt };
  }

  const solidId = idBySlug.get('solid') as string;
  const slippingId = idBySlug.get('slipping') as string;
  const knownId = idBySlug.get('known') as string;

  await db.insert(cards).values([
    taughtCard(solidId, Rating.Easy),
    // Further back than the others — an `Again` rating alone landed right on
    // the AT_RISK_BELOW (0.6) boundary (predicted recall decays with time, so
    // a fresher review reads as barely "solid" instead); a longer gap since
    // the last review pushes it comfortably below the threshold.
    taughtCard(slippingId, Rating.Again, 6),
    taughtCard(knownId, Rating.Good),
  ]);

  // `known` also needs a high diagnostic estimate — `taughtAt` alone lands on
  // `taught` (`backend/src/lib/score.ts`), same as `solid`/`slipping` above.
  await db
    .update(topics)
    .set({ diagnosticState: { estimates: { [knownId]: 0.95 }, asked: [knownId] } })
    .where(eq(topics.id, topic.id));

  const session = await createSession(userId, 'web');
  const output = { userId, webSessionToken: session.token, topicId: topic.id };
  writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
  console.log(`seedMapUser: topic ${topic.id}, token written to ${OUT_FILE}`);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  await main();
  await pg.end();
}
