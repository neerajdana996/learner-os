/**
 * `pnpm seed:matrix` — many users, many product states, no model calls (E2E-015).
 *
 * Raised directly by the founder: rather than one seeded learner in one
 * state, build several users spanning the states the product actually has,
 * so a UI/UX walkthrough can look at each one and judge whether it's clear —
 * not whether a route returns 200.
 *
 * **A real constraint shaped this script.** `DashboardPage.tsx` and
 * `AppBar.tsx` both read `topics.topics[0]` with no way to switch topics —
 * a user's second and third topic exist in the database but are not
 * reachable through any in-app navigation, only by knowing `/map/:topicId`
 * or `/results/:topicId` directly (plan.md already scopes the pilot this
 * way; T-058 is where that opens up). So this seeds **one full configuration
 * per user** — closer to how the pilot itself runs one topic per learner —
 * with two users additionally given a second, UI-unreachable topic
 * specifically to demonstrate that limitation for the audit, not to route
 * through it.
 *
 * Every topic reuses the same fixture content `pnpm seed` uses
 * (`backend/fixtures/`). This script is about **states**, not about content
 * quality — that is T-024/T-045's job. Idempotent: keyed by the
 * `matrix-` email prefix, so it never touches `dev@learnos.local` and a
 * second run replaces its own users cleanly rather than piling up more.
 */
import { readFileSync, writeFileSync } from 'node:fs';
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
import { validateConceptMap } from '../generator/conceptMap.js';
import { validateItems } from '../generator/items.js';
import { validateTeaching } from '../generator/teaching.js';
import { env } from '../lib/env.js';
import { pickHeldOut, seededRng, HELD_OUT_MIN_ORDER, HELD_OUT_RATIO } from '../lib/heldOut.js';
import { newCard, Rating, scheduleReview, toDbCard, type Grade } from '../scheduler/index.js';
import { createSession } from '../modules/auth/auth.service.js';
import { isLocalDatabase } from './seed.js';

const DAY = 86_400_000;
const PREFIX = 'matrix-';
// Deliberately NOT under e2e/.artifacts: Playwright clears its `outputDir`
// at the start of every run, which would delete this file before the audit
// project's tests ever got to read it.
const OUT_FILE = join(dirname(fileURLToPath(import.meta.url)), '../../../e2e/matrix-data.json');

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures');
const read = (name: string) => JSON.parse(readFileSync(join(fixtures, name), 'utf8'));

type TopicStatus = 'generating' | 'active' | 'testing' | 'holdout' | 'done' | 'failed';

interface TopicConfig {
  /** Suffix on the title, so two topics for the same user are distinguishable
   *  in a screenshot without opening dev tools. */
  label: string;
  status: TopicStatus;
  /** null = diagnostic never started. */
  diagnosticStarted: boolean;
  taughtCount: number;
  /** Offsets applied to `cards.due` for the taught concepts, mirroring
   *  `seed.ts`'s staggering — negative is overdue. */
  dueOffsets?: number[];
  heldOutSeed?: number;
  teachMode: 'alternate' | 'all_try_first' | 'all_example_first';
  includeFormatItems?: boolean;
  error?: string;
  /**
   * Days before `now` the topic's 7-day teaching window *started*.
   * `testLifecycle.ts`'s `testIsDue()` computes the cold-test day as
   * `startsAt`'s calendar day + 30 — found the hard way, seeding a `testing`
   * topic with the same `now`-anchored `startsAt` every other status uses,
   * which meant `POST /topics/:id/tests` always came back `409 test_not_due`
   * because `endsAt` (7 days out) was still in the future. Default 0 (a
   * topic just starting today); `holdout`/`testing`/`done` override it.
   */
  startedDaysAgo?: number;
}

interface UserConfig {
  email: string;
  description: string;
  primary: TopicConfig;
  /** A second topic, deliberately unreachable through the dashboard/nav
   *  (T-058's limitation) — present only to demonstrate and document it. */
  extra?: TopicConfig;
}

const CONFIGS: UserConfig[] = [
  {
    email: `${PREFIX}01@learnos.local`,
    description: 'Fresh — still on the generation wait screen',
    primary: { label: 'onboarding', status: 'generating', diagnosticStarted: false, taughtCount: 0, teachMode: 'alternate' },
  },
  {
    email: `${PREFIX}02@learnos.local`,
    description: 'Signed up, about to take the diagnostic',
    primary: { label: 'day 0', status: 'active', diagnosticStarted: false, taughtCount: 0, teachMode: 'alternate' },
  },
  {
    email: `${PREFIX}03@learnos.local`,
    description: 'Diagnostic done, nothing taught yet — about to start day 1',
    primary: { label: 'day 1, untaught', status: 'active', diagnosticStarted: true, taughtCount: 0, teachMode: 'alternate' },
  },
  {
    email: `${PREFIX}04@learnos.local`,
    description: 'Mid-course: some taught, some due, some untaught',
    primary: {
      label: 'mid-course',
      status: 'active',
      diagnosticStarted: true,
      taughtCount: 5,
      dueOffsets: [-3 * DAY, -2 * DAY, -1 * DAY, 0, 2 * DAY],
      teachMode: 'alternate',
    },
    // Unreachable via nav (topics[0] is "mid-course") — audits the code-answer
    // formats (T-086..T-088) outside the plain fixture, reached only by URL.
    extra: {
      label: 'formats (URL-only)',
      status: 'active',
      diagnosticStarted: true,
      taughtCount: 3,
      dueOffsets: [-1 * DAY, 0, 1 * DAY],
      teachMode: 'alternate',
      includeFormatItems: true,
    },
  },
  {
    email: `${PREFIX}05@learnos.local`,
    description: 'Fully taught, nothing due today — the caught-up state',
    primary: {
      label: 'caught up',
      status: 'active',
      diagnosticStarted: true,
      taughtCount: 5,
      dueOffsets: [3 * DAY, 4 * DAY, 5 * DAY, 6 * DAY, 7 * DAY],
      teachMode: 'all_example_first',
    },
    // Unreachable via nav — a `done` topic reached only by /results/:id, to
    // confirm that route works for a topic that never appears in this user's
    // own dashboard.
    extra: {
      label: 'done (URL-only)',
      status: 'done',
      diagnosticStarted: true,
      taughtCount: 5,
      dueOffsets: [-10 * DAY, -10 * DAY, -10 * DAY, -10 * DAY, -10 * DAY],
      teachMode: 'alternate',
      startedDaysAgo: 33,
    },
  },
  {
    email: `${PREFIX}06@learnos.local`,
    description: 'Holdout — day 8-29, the quiet period',
    primary: {
      label: 'holdout',
      status: 'holdout',
      diagnosticStarted: true,
      taughtCount: 5,
      dueOffsets: [-15 * DAY, -14 * DAY, -13 * DAY, -12 * DAY, -11 * DAY],
      teachMode: 'all_try_first',
      // 10 days in: teaching (a 7-day window) finished 3 days ago, and the
      // cold test isn't due for another 20 — this IS the silence.
      startedDaysAgo: 10,
    },
  },
  {
    email: `${PREFIX}07@learnos.local`,
    description: 'Testing — the day-30 cold test is available',
    primary: {
      label: 'testing',
      status: 'testing',
      diagnosticStarted: true,
      taughtCount: 5,
      dueOffsets: [-30 * DAY, -30 * DAY, -30 * DAY, -30 * DAY, -30 * DAY],
      teachMode: 'alternate',
      // 31 days in: coldTestDay (startsAt + 30) was yesterday, so
      // testIsDue() actually returns true and /topics/:id/tests works.
      startedDaysAgo: 31,
    },
  },
  {
    email: `${PREFIX}08@learnos.local`,
    description: 'Done — the day-30 test is complete, results are ready',
    primary: {
      label: 'done',
      status: 'done',
      diagnosticStarted: true,
      taughtCount: 5,
      dueOffsets: [-31 * DAY, -31 * DAY, -31 * DAY, -31 * DAY, -31 * DAY],
      teachMode: 'alternate',
      startedDaysAgo: 33,
    },
  },
  {
    email: `${PREFIX}09@learnos.local`,
    description: 'A generation that failed outright',
    primary: {
      label: 'failed',
      status: 'failed',
      diagnosticStarted: false,
      taughtCount: 0,
      teachMode: 'alternate',
      error: 'the model returned malformed JSON three times in a row',
    },
  },
];

async function wipeMatrix(): Promise<void> {
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
    // Every other table with a `users.id` foreign key — found the hard way,
    // by Postgres refusing the user delete with a constraint violation on
    // `sessions` the first time this ran. `topics`/`cards`/`reviewEvents`
    // are handled above via their own topic/concept loops; these five are
    // not reachable from a topic at all, so they need their own pass.
    await db.delete(dailyPulse).where(eq(dailyPulse.userId, id));
    await db.delete(clientEvents).where(eq(clientEvents.userId, id));
    await db.delete(authTokens).where(eq(authTokens.userId, id));
    await db.delete(oauthAccounts).where(eq(oauthAccounts.userId, id));
    await db.delete(sessions).where(eq(sessions.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }
}

interface BuiltTopic {
  topicId: string;
  label: string;
  status: TopicStatus;
  concepts: number;
  heldOut: number;
  taught: number;
}

async function buildTopic(userId: string, titleBase: string, cfg: TopicConfig, now: Date): Promise<BuiltTopic> {
  const map = validateConceptMap(read('conceptMap.react-hooks.json'));
  const itemSet = validateItems(read('items.usestate.json'));
  const teaching = validateTeaching(read('teaching.usestate.json'));

  const startsAt = new Date(now.getTime() - (cfg.startedDaysAgo ?? 0) * DAY);
  const [topic] = await db
    .insert(topics)
    .values({
      userId,
      title: `${titleBase} — ${cfg.label}`,
      why: 'Seeded for the E2E-015 UX audit — not a real learner.',
      status: cfg.status,
      error: cfg.error ?? null,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 7 * DAY),
      dailyBudgetMin: 10,
      // `null` is "never started"; a non-null value with every concept marked
      // asked is close enough to "done" for the map/session to treat prior
      // knowledge as resolved, without depending on the diagnostic engine's
      // own termination shape (that's diagnostic.service.ts's own contract,
      // not this script's to reproduce byte for byte).
      diagnosticState: cfg.diagnosticStarted ? { estimates: {}, asked: [] } : null,
    })
    .returning();
  if (!topic) throw new Error(`seedMatrix: topic insert returned no row for ${titleBase}`);

  // `generating`/`failed` topics stop here — a real topic mid-generation or
  // one that failed outright has no concepts yet either.
  if (cfg.status === 'generating' || cfg.status === 'failed') {
    return { topicId: topic.id, label: cfg.label, status: cfg.status, concepts: 0, heldOut: 0, taught: 0 };
  }

  const ordered = map.concepts.map((concept, index) => ({ ...concept, order: index + 1 }));
  const rng = seededRng(cfg.heldOutSeed ?? 7);
  const heldOut = pickHeldOut(ordered, HELD_OUT_RATIO, HELD_OUT_MIN_ORDER, rng);

  const inserted = await db
    .insert(concepts)
    .values(
      ordered.map((concept) => {
        const isHeldOut = heldOut.has(concept.slug);
        const teachMode: 'try_first' | 'example_first' =
          cfg.teachMode === 'all_try_first'
            ? 'try_first'
            : cfg.teachMode === 'all_example_first'
              ? 'example_first'
              : concept.order % 2 === 0
                ? 'example_first'
                : 'try_first';
        return {
          topicId: topic.id,
          slug: concept.slug,
          title: concept.title,
          summary: concept.summary,
          order: concept.order,
          heldOut: isHeldOut,
          teachMode,
          domain: concept.domain,
          tryFirstPrompt: isHeldOut ? null : teaching.tryFirstPrompt,
          teachBlock: isHeldOut ? null : teaching.teachBlock,
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

  if (cfg.includeFormatItems) {
    // The same block-format seed T-140 built, aimed at this topic's first
    // teachable concept — audits the richer answer surfaces this fixture's
    // plain items never exercise.
    const { seedFormatsFor } = await import('./seedFormats.js');
    const target = teachable[0];
    if (target) await seedFormatsFor(target.id);
  }

  const history: { offset: number; rating: Grade }[] = [
    { offset: -3 * DAY, rating: Rating.Good },
    { offset: -2 * DAY, rating: Rating.Easy },
    { offset: -1 * DAY, rating: Rating.Good },
    { offset: 0, rating: Rating.Again },
    { offset: 2 * DAY, rating: Rating.Good },
  ];

  const taught = teachable.slice(0, cfg.taughtCount);
  if (taught.length > 0) {
    await db.insert(cards).values(
      taught.map((row, index) => {
        const step = history[index] ?? history[0];
        const dueOffset = cfg.dueOffsets?.[index] ?? step?.offset ?? 0;
        const taughtAt = new Date(now.getTime() - 4 * DAY);
        const reviewedAt = new Date(now.getTime() - 3 * DAY);
        const reviewed = scheduleReview(newCard(taughtAt), step?.rating ?? Rating.Good, reviewedAt);
        return {
          userId,
          conceptId: row.id,
          ...toDbCard(reviewed),
          due: new Date(now.getTime() + dueOffset),
          taughtAt,
        };
      }),
    );
  }

  // A completed cold test, for `done` topics — otherwise `ResultsPage.tsx`
  // hits its own early-return branch (`data.taught === null`) and there is
  // nothing on screen for the audit to actually judge. Scores are invented
  // but shaped exactly like `TestScoresSchema`, and `perConcept` covers every
  // teachable concept so the "what stuck / what didn't" split has something
  // in both lists.
  if (cfg.status === 'done') {
    const perConcept: Record<string, number> = {};
    teachable.forEach((row, i) => {
      // Alternate above/below the 0.5 "stuck" threshold ResultsPage.tsx uses.
      perConcept[row.id] = i % 2 === 0 ? 0.82 : 0.35;
    });
    await db.insert(tests).values({
      userId,
      topicId: topic.id,
      kind: 'day30',
      itemIds: [],
      scores: {
        overall: 0.64,
        taught: 0.71,
        heldOut: 0.22,
        transfer: 0.5,
        calibrationGap: 0.08,
        perConcept,
      },
    });
  }

  return {
    topicId: topic.id,
    label: cfg.label,
    status: cfg.status,
    concepts: inserted.length,
    heldOut: inserted.length - teachable.length,
    taught: taught.length,
  };
}

interface MatrixEntry {
  email: string;
  description: string;
  webSessionToken: string;
  primary: BuiltTopic;
  extra: BuiltTopic | null;
}

async function main(): Promise<void> {
  if (!isLocalDatabase(env.DATABASE_URL) && process.env.SEED_FORCE !== '1') {
    console.error(
      `seedMatrix: refusing to run against ${new URL(env.DATABASE_URL).hostname}. Set SEED_FORCE=1 if you really mean it.`,
    );
    process.exit(1);
  }

  await wipeMatrix();

  const now = new Date();
  const entries: MatrixEntry[] = [];

  for (const cfg of CONFIGS) {
    const [user] = await db
      .insert(users)
      .values({ email: cfg.email, name: cfg.email.split('@')[0], timezone: 'Asia/Kolkata' })
      .returning();
    if (!user) throw new Error(`seedMatrix: could not create ${cfg.email}`);

    // `GET /topics` orders newest-first (`orderBy(desc(topics.createdAt))`,
    // topics.repository.ts) — found the hard way, by the audit's screenshots
    // showing the "URL-only" extra topic in the dashboard's own nav instead
    // of the primary. `topics[0]` is whichever topic was created *last*, not
    // first, so the extra has to be created *before* the primary for the
    // primary to actually be the one AppBar/DashboardPage show.
    const extra = cfg.extra ? await buildTopic(user.id, 'React Hooks', cfg.extra, now) : null;
    const primary = await buildTopic(user.id, 'React Hooks', cfg.primary, now);

    // A web session, not the extension kind — this is what the Playwright
    // audit spec injects as the `learnos_session` cookie to sign in as each
    // matrix user directly, since `POST /auth/dev-login` only ever
    // authenticates the one fixed dev account (auth.service.ts's own check
    // against `env.DEV_LOGIN_EMAIL`).
    const session = await createSession(user.id, 'web', now);

    entries.push({ email: cfg.email, description: cfg.description, webSessionToken: session.token, primary, extra });
  }

  writeFileSync(OUT_FILE, JSON.stringify(entries, null, 2));

  console.log(`\nseeded ${entries.length} matrix users\n`);
  for (const e of entries) {
    console.log(`  ${e.email.padEnd(28)} ${e.description}`);
    console.log(`    primary: ${e.primary.status.padEnd(10)} ${e.primary.concepts} concepts (${e.primary.heldOut} held out), ${e.primary.taught} taught  [${e.primary.topicId}]`);
    if (e.extra) {
      console.log(`    extra:   ${e.extra.status.padEnd(10)} ${e.extra.concepts} concepts (${e.extra.heldOut} held out), ${e.extra.taught} taught  [${e.extra.topicId}] — URL-only, not in this user's dashboard`);
    }
  }
  console.log(`\n  written to ${OUT_FILE} for the Playwright audit spec to read.\n`);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  await main();
  await pg.end();
}
