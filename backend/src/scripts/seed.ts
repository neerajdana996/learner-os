/**
 * `pnpm seed` — a realistic local dataset in one command, with no model calls.
 *
 * Everything comes from `backend/fixtures/`, so this works with no API key and
 * costs nothing. It exists so the app is *usable* the moment you start it:
 * without it, seeing a due card means running a real generation and waiting
 * out a 30-day schedule.
 *
 * Idempotent — developers run it repeatedly, and a second run must not leave
 * two dev users or two topics behind.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, inArray } from 'drizzle-orm';
import { db, pg } from '../db/client.js';
import {
  cards,
  conceptPrereqs,
  concepts,
  items,
  reviewEvents,
  sessionDays,
  tests,
  topics,
  users,
} from '../db/schema.js';
import { validateConceptMap } from '../generator/conceptMap.js';
import { validateItems } from '../generator/items.js';
import { validateTeaching } from '../generator/teaching.js';
import { env } from '../lib/env.js';
import { pickHeldOut, seededRng, HELD_OUT_MIN_ORDER, HELD_OUT_RATIO } from '../lib/heldOut.js';
import { newCard, Rating, scheduleReview, toDbCard, type Grade } from '../scheduler/index.js';
import { createSession } from '../modules/auth/auth.service.js';

const DEV_EMAIL = 'dev@learnos.local';
const DAY = 86_400_000;
const TAUGHT_COUNT = 5;
/** Fixed so two runs produce the same map — a seed you can't reason about is
 *  worse than no seed. */
const RNG_SEED = 7;

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures');
const read = (name: string) => JSON.parse(readFileSync(join(fixtures, name), 'utf8'));

/**
 * Seeding runs destructive deletes, so anything that isn't obviously a local
 * database is refused. `pnpm seed` against a deployed URL by accident is not a
 * mistake worth leaving available.
 */
export function isLocalDatabase(url: string): boolean {
  const host = new URL(url).hostname;
  // `postgres` is the compose service name, so it counts as local.
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === 'postgres';
}

export interface SeedResult {
  userId: string;
  topicId: string;
  concepts: number;
  heldOut: number;
  items: number;
  taught: number;
  extensionToken: string;
}

/** Exported so tests can run it against the test database rather than shelling
 *  out to the script. */
export async function seed(): Promise<SeedResult> {
  const map = validateConceptMap(read('conceptMap.react-hooks.json'));
  const itemSet = validateItems(read('items.usestate.json'));
  const teaching = validateTeaching(read('teaching.usestate.json'));

  // Idempotency: the dev user is keyed by a fixed email, and everything below
  // hangs off it, so clearing their topics is enough to make a re-run clean.
  let [user] = await db.select().from(users).where(eq(users.email, DEV_EMAIL));
  if (!user) {
    [user] = await db
      .insert(users)
      .values({ email: DEV_EMAIL, name: 'Dev', timezone: 'Asia/Kolkata' })
      .returning();
  }
  if (!user) throw new Error('seed: could not create the dev user');

  // Deleted in foreign-key order, children first (T-078).
  //
  // The first version cleared items, prereqs and cards but not the rows that
  // point *at* them, so re-seeding worked on a fresh database and failed the
  // moment anyone had actually used the app: a `review_events` row references
  // the item it was an answer to, and `session_days` and `tests` reference the
  // topic. Since resetting after a session is exactly why anyone runs this
  // twice, the failure landed precisely when the script was most needed.
  const existing = await db.select({ id: topics.id }).from(topics).where(eq(topics.userId, user.id));
  for (const topic of existing) {
    const conceptIds = (
      await db.select({ id: concepts.id }).from(concepts).where(eq(concepts.topicId, topic.id))
    ).map((row) => row.id);

    if (conceptIds.length > 0) {
      // Not scoped to this user: an item belongs to the topic, and a stray
      // event from another account would block the delete just the same.
      await db.delete(reviewEvents).where(inArray(reviewEvents.conceptId, conceptIds));
      await db.delete(cards).where(inArray(cards.conceptId, conceptIds));
      await db.delete(items).where(inArray(items.conceptId, conceptIds));
      await db.delete(conceptPrereqs).where(inArray(conceptPrereqs.conceptId, conceptIds));
    }

    await db.delete(sessionDays).where(eq(sessionDays.topicId, topic.id));
    await db.delete(tests).where(eq(tests.topicId, topic.id));
    await db.delete(concepts).where(eq(concepts.topicId, topic.id));
    await db.delete(topics).where(eq(topics.id, topic.id));
  }

  const now = new Date();
  const [topic] = await db
    .insert(topics)
    .values({
      userId: user.id,
      title: map.topic,
      why: 'I re-read the docs every time and it never sticks.',
      status: 'active',
      startsAt: now,
      endsAt: new Date(now.getTime() + 30 * DAY),
      dailyBudgetMin: 10,
    })
    .returning();
  if (!topic) throw new Error('seed: topic insert returned no row');

  const ordered = map.concepts.map((concept, index) => ({ ...concept, order: index + 1 }));
  const rng = seededRng(RNG_SEED);
  const heldOut = pickHeldOut(ordered, HELD_OUT_RATIO, HELD_OUT_MIN_ORDER, rng);

  const inserted = await db
    .insert(concepts)
    .values(
      ordered.map((concept) => {
        const isHeldOut = heldOut.has(concept.slug);
        return {
          topicId: topic.id,
          slug: concept.slug,
          title: concept.title,
          summary: concept.summary,
          order: concept.order,
          heldOut: isHeldOut,
          teachMode: (concept.order % 2 === 0 ? 'example_first' : 'try_first') as
            | 'try_first'
            | 'example_first',
          // Held-out concepts are never taught, so they carry no teaching
          // content — the same rule the real worker follows (T-053).
          tryFirstPrompt: isHeldOut ? null : teaching.tryFirstPrompt,
          explanationShort: isHeldOut ? null : teaching.explanationShort,
          explanationLong: isHeldOut ? null : teaching.explanationLong,
          corrections: isHeldOut ? [] : teaching.corrections,
        };
      }),
    )
    .returning({ id: concepts.id, slug: concepts.slug, order: concepts.order, heldOut: concepts.heldOut });

  const idBySlug = new Map(inserted.map((row) => [row.slug, row.id]));

  const prereqRows = ordered.flatMap((concept) =>
    [...new Set(concept.prereqs)].flatMap((prereq) => {
      const conceptId = idBySlug.get(concept.slug);
      const prerequisiteConceptId = idBySlug.get(prereq);
      return conceptId && prerequisiteConceptId ? [{ conceptId, prerequisiteConceptId }] : [];
    }),
  );
  if (prereqRows.length > 0) await db.insert(conceptPrereqs).values(prereqRows);

  const teachable = inserted.filter((row) => !row.heldOut);
  await db.insert(items).values(
    teachable.flatMap((row) =>
      itemSet.items.map((item) => ({
        conceptId: row.id,
        type: item.payload.type,
        payload: item.payload,
        isTransfer: item.isTransfer,
      })),
    ),
  );

  // Each taught concept gets a real review history, not a blank card: an
  // unreviewed card has stability 0, so `predictedRecall` is 0 and the map
  // renders a score of 0 with everything flagged at risk — technically correct
  // and completely useless to develop against.
  //
  // Ratings vary so the map shows a spread: four remembered, one forgotten,
  // which is what an at-risk concept actually looks like.
  const taught = teachable.slice(0, TAUGHT_COUNT);
  const history: { offset: number; rating: Grade }[] = [
    { offset: -3 * DAY, rating: Rating.Good },
    { offset: -2 * DAY, rating: Rating.Easy },
    { offset: -1 * DAY, rating: Rating.Good },
    { offset: 0, rating: Rating.Again },
    { offset: 2 * DAY, rating: Rating.Good },
  ];

  await db.insert(cards).values(
    taught.map((row, index) => {
      const step = history[index] ?? history[0];
      const taughtAt = new Date(now.getTime() - 4 * DAY);
      const reviewedAt = new Date(now.getTime() - 3 * DAY);
      const reviewed = scheduleReview(newCard(taughtAt), step?.rating ?? Rating.Good, reviewedAt);
      return {
        userId: user.id,
        conceptId: row.id,
        ...toDbCard(reviewed),
        // Override the scheduler's date so the queue is staggered — some
        // overdue, some ahead — rather than all landing together.
        due: new Date(now.getTime() + (step?.offset ?? 0)),
        taughtAt,
      };
    }),
  );

  const extension = await createSession(user.id, 'extension');

  return {
    userId: user.id,
    topicId: topic.id,
    concepts: inserted.length,
    heldOut: inserted.length - teachable.length,
    items: teachable.length * itemSet.items.length,
    taught: taught.length,
    extensionToken: extension.token,
  };
}

async function main() {
  if (!isLocalDatabase(env.DATABASE_URL) && process.env.SEED_FORCE !== '1') {
    console.error(
      `seed: refusing to run against ${new URL(env.DATABASE_URL).hostname}. Set SEED_FORCE=1 if you really mean it.`,
    );
    process.exit(1);
  }

  const result = await seed();
  const overdue = 4;
  console.log(`
seeded the dev dataset

  user            ${DEV_EMAIL}
  user id         ${result.userId}
  topic id        ${result.topicId}
  concepts        ${result.concepts} (${result.heldOut} held out)
  items           ${result.items}
  taught          ${result.taught}, ${overdue} due now
  extension token ${result.extensionToken}

  Drive it without a magic link:  VITE_DEV_USER_ID=${result.userId} pnpm --dir ../frontend dev
`);
}

// Only when run as a script. Importing this module (the tests do) must not
// seed a database and then close the shared connection pool underneath the
// rest of the suite.
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  await main();
  await pg.end();
}
