/**
 * `pnpm seed:formats:showcase` — one concept per answer format, so every
 * format can actually be *seen* (E2E-008).
 *
 * `seedFormats.ts` puts all five formats on a single concept, which is right
 * for what that script proves: the payloads store and pass
 * `ItemPayloadSchema`. But the scheduler serves **one item per due concept**
 * (`due.repository.ts`'s `findCandidates`), so a spec driving a session past
 * that concept sees exactly one of the five, chosen by whatever the queue
 * ordering happens to produce. Spreading one format per concept is what makes
 * "screenshot every format" a fact rather than a coin toss.
 *
 * The payloads themselves are imported, not copied — `FORMAT_SEEDS` is the one
 * source, so this arrangement cannot drift from the other one.
 *
 * **`codeEditor` is seeded but will not appear in a session, by design.**
 * `reviewEligible()` excludes it because a `codeEditor` is never a review
 * (T-088), so its card is due and its item is filtered out. It is written here
 * anyway so the row exists for any surface that does show it, and so the
 * absence is something a spec can assert rather than a gap nobody notices.
 *
 * Idempotent — keyed by a fixed email, wiped and recreated every run.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, inArray } from 'drizzle-orm';
import { ItemPayloadSchema, answerKindOf, type ItemPayload } from '@learnos/shared';
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
import { newCard, Rating, scheduleReview, toDbCard } from '../scheduler/index.js';
import { isLocalDatabase } from './seed.js';
import { FORMAT_SEEDS } from './seedFormats.js';

const EMAIL = 'e2e-formats@learnos.local';
const OUT_FILE = join(dirname(fileURLToPath(import.meta.url)), '../../../e2e/format-user.json');
const DAY = 86_400_000;

/** The block kind each seed carries — also the concept slug, so a failing spec
 *  names the format rather than an index. */
function kindOf(seed: (typeof FORMAT_SEEDS)[number]): string {
  const blocks = (seed.payload as { blocks?: { kind: string }[] }).blocks ?? [];
  return blocks[0]?.kind ?? 'plain';
}

async function wipeExisting(): Promise<void> {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, EMAIL));
  if (!existing) return;

  const topicRows = await db.select({ id: topics.id }).from(topics).where(eq(topics.userId, existing.id));
  for (const { id: topicId } of topicRows) {
    const conceptIds = (
      await db.select({ id: concepts.id }).from(concepts).where(eq(concepts.topicId, topicId))
    ).map((c) => c.id);
    if (conceptIds.length) {
      await db.delete(reviewEvents).where(inArray(reviewEvents.conceptId, conceptIds));
      await db.delete(conceptPrereqs).where(inArray(conceptPrereqs.conceptId, conceptIds));
      await db.delete(cards).where(inArray(cards.conceptId, conceptIds));
      await db.delete(items).where(inArray(items.conceptId, conceptIds));
      await db.delete(concepts).where(eq(concepts.topicId, topicId));
    }
    await db.delete(tests).where(eq(tests.topicId, topicId));
  }
  await db.delete(topics).where(eq(topics.userId, existing.id));
  await db.delete(sessionDays).where(eq(sessionDays.userId, existing.id));
  await db.delete(dailyPulse).where(eq(dailyPulse.userId, existing.id));
  await db.delete(clientEvents).where(eq(clientEvents.userId, existing.id));
  await db.delete(sessions).where(eq(sessions.userId, existing.id));
  await db.delete(authTokens).where(eq(authTokens.userId, existing.id));
  await db.delete(oauthAccounts).where(eq(oauthAccounts.userId, existing.id));
  await db.delete(users).where(eq(users.id, existing.id));
}

async function main(): Promise<void> {
  if (!isLocalDatabase(env.DATABASE_URL)) {
    console.error(`seedFormatShowcase: refusing to run against ${new URL(env.DATABASE_URL).hostname}.`);
    process.exit(1);
  }

  await wipeExisting();

  const [userRow] = await db.insert(users).values({ email: EMAIL, name: null }).returning({ id: users.id });
  if (!userRow) throw new Error('seedFormatShowcase: user insert returned no row');
  const userId = userRow.id;

  const [topic] = await db
    .insert(topics)
    .values({ userId, title: 'Answer formats', status: 'active' })
    .returning({ id: topics.id });
  if (!topic) throw new Error('seedFormatShowcase: topic insert returned no row');

  const kinds = FORMAT_SEEDS.map(kindOf);

  const inserted = await db
    .insert(concepts)
    .values(
      FORMAT_SEEDS.map((seed, i) => {
        const kind = kindOf(seed);
        return {
          topicId: topic.id,
          slug: kind,
          title: `The ${kind} card`,
          order: i + 1,
          heldOut: false,
          teachMode: 'try_first' as const,
          tryFirstPrompt: `What do you remember about the ${kind} format?`,
          explanationShort: `The ${kind} answer surface, rendered from real data.`,
          explanationLong: `A seeded ${kind} item, so the ${kind} answer surface can be rendered and graded without a live generation.`,
          corrections: [],
        };
      }),
    )
    .returning({ id: concepts.id, slug: concepts.slug });
  const idBySlug = new Map(inserted.map((r) => [r.slug, r.id]));

  const now = new Date();
  for (const seed of FORMAT_SEEDS) {
    const conceptId = idBySlug.get(kindOf(seed));
    if (!conceptId) throw new Error(`seedFormatShowcase: no concept for ${kindOf(seed)}`);
    const payload: ItemPayload = ItemPayloadSchema.parse(seed.payload);
    await db.insert(items).values({
      conceptId,
      type: seed.type,
      payload,
      answerKind: answerKindOf(payload.blocks ?? []),
      isTransfer: false,
    });
  }

  // Taught four days ago and reviewed six days' worth of decay away, so every
  // card is overdue now — `due` is overridden rather than trusted, because a
  // scheduler change that pushed these into the future would turn this fixture
  // into an empty session, which reads as the spec being broken.
  await db.insert(cards).values(
    inserted.map((row) => {
      const taughtAt = new Date(now.getTime() - 4 * DAY);
      const reviewed = scheduleReview(newCard(taughtAt), Rating.Again, new Date(now.getTime() - 3 * DAY));
      return {
        userId,
        conceptId: row.id,
        ...toDbCard(reviewed),
        due: new Date(now.getTime() - DAY),
        taughtAt,
      };
    }),
  );

  const session = await createSession(userId, 'web');
  writeFileSync(
    OUT_FILE,
    JSON.stringify({ userId, webSessionToken: session.token, topicId: topic.id, kinds }, null, 2),
  );
  console.log(`seedFormatShowcase: ${kinds.length} concepts (${kinds.join(', ')}), token written to ${OUT_FILE}`);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  await main();
  await pg.end();
}
