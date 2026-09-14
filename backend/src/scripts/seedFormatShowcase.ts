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
import { renderDiagram, renderSequence } from '../generator/systemsSvg.js';
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

/**
 * ---------- presentation blocks, and the same kind on different data ----------
 *
 * `FORMAT_SEEDS` covers the five *answer* surfaces. The six content kinds —
 * `prose`, `code`, `codeDiff`, `terminal`, `diagram`, `sequence` — had no
 * fixture at all, so nothing had ever rendered them from a database row
 * either.
 *
 * One entry per kind is not enough for these. What breaks a code listing is
 * not the kind, it is the *data*: margin notes push the gutter, a dimmed range
 * changes what is emphasised, a twelve-line listing is the one that overflows.
 * So the code and diagram kinds get several entries each, differing only in
 * the shape of their content — which is what turns this from "does it render"
 * into "does it render when the data is awkward".
 *
 * Each carries a plain text answer: a content block has no answer surface, so
 * the card correctly falls through to the text box, and the item stays
 * answerable rather than being a dead end in the queue.
 */
interface Variant {
  /** Also the concept slug, so a failure names the case. */
  slug: string;
  type: 'recall' | 'application';
  blocks: unknown[];
  prompt: string;
}

const MARK = '[card]';

/** Exactly twelve lines — the schema's own limit, so this fixture also pins
 *  the boundary rather than sitting comfortably inside it. */
const WINDOW_SRC = [
  'function longest(s, k) {',
  '  const counts = new Map();',
  '  let left = 0;',
  '  for (let right = 0; right < s.length; right += 1) {',
  '    const c = s[right];',
  '    counts.set(c, (counts.get(c) ?? 0) + 1);',
  '    while (counts.size > k) {',
  '      counts.delete(s[left]);',
  '      left += 1;',
  '    }',
  '  }',
  '}',
].join('\n');

const SHORT_SRC = 'const seen = new Set();\nfor (const n of nums) {\n  if (seen.has(k - n)) return true;\n  seen.add(n);\n}';

const DIAGRAM_SMALL = {
  nodes: [
    { id: 'client', label: 'Client' },
    { id: 'cache', label: 'Cache' },
  ],
  edges: [{ from: 'client', to: 'cache', label: 'reads' }],
};

const DIAGRAM_FULL = {
  nodes: [
    { id: 'client', label: 'Client' },
    { id: 'primary', label: 'Primary' },
    { id: 'replica-a', label: 'Replica A' },
    { id: 'replica-b', label: 'Replica B' },
    { id: 'cache', label: 'Cache' },
  ],
  edges: [
    { from: 'client', to: 'primary', label: 'writes' },
    { from: 'primary', to: 'replica-a', label: 'replicates async' },
    { from: 'primary', to: 'replica-b', label: 'replicates async' },
    { from: 'client', to: 'cache', label: 'reads' },
    { from: 'cache', to: 'replica-a' },
  ],
};

const SEQUENCE_STALE = {
  lanes: ['Client', 'Primary', 'Replica'],
  messages: [
    { from: 'Client', to: 'Primary', label: 'write x = 1' },
    { from: 'Primary', to: 'Replica', label: 'replicate x = 1', delayed: true },
    { from: 'Client', to: 'Replica', label: 'read x' },
    { from: 'Replica', to: 'Client', label: 'returns x = 0' },
  ],
};

const CARD_VARIANTS: Variant[] = [
  {
    slug: 'prose',
    type: 'recall',
    prompt: `${MARK} A prose block, for a concept with nothing to draw.`,
    blocks: [
      {
        kind: 'prose',
        slot: 'context',
        text: 'A sliding window keeps a running answer over a contiguous range, moving its right edge forward and pulling its left edge in only when an invariant breaks. The work is proportional to the number of edge moves, not to the number of windows.',
      },
    ],
  },
  {
    slug: 'code-short',
    type: 'recall',
    prompt: `${MARK} A short code listing — four lines, no notes.`,
    blocks: [{ kind: 'code', slot: 'context', lang: 'typescript', src: SHORT_SRC, short: null, notes: [], dim: null }],
  },
  {
    slug: 'code-notes',
    type: 'recall',
    prompt: `${MARK} A code listing carrying the maximum three margin notes.`,
    blocks: [
      {
        kind: 'code',
        slot: 'context',
        lang: 'typescript',
        src: WINDOW_SRC,
        short: null,
        notes: [
          { line: 2, text: 'the window contents, counted per character' },
          { line: 7, text: 'the invariant: at most k distinct' },
          { line: 9, text: 'the only place left ever moves' },
        ],
        dim: null,
      },
    ],
  },
  {
    slug: 'code-dimmed',
    type: 'recall',
    prompt: `${MARK} A long listing with everything outside the shrink loop dimmed.`,
    blocks: [
      {
        kind: 'code',
        slot: 'context',
        lang: 'typescript',
        src: WINDOW_SRC,
        short: null,
        notes: [],
        // The setup and the return are context; the question is the loop.
        dim: { from: 1, to: 3 },
      },
    ],
  },
  {
    slug: 'codeDiff',
    type: 'recall',
    prompt: `${MARK} A before/after diff — the fix is one line.`,
    blocks: [
      {
        kind: 'codeDiff',
        slot: 'context',
        lang: 'typescript',
        before: 'while (counts.size > k) {\n  counts.set(c, counts.get(c) - 1);\n  left += 1;\n}',
        after: 'while (counts.size > k) {\n  counts.set(c, counts.get(c) - 1);\n  if (counts.get(c) === 0) counts.delete(c);\n  left += 1;\n}',
        caption: 'Without the delete, size never falls and the loop cannot exit.',
      },
    ],
  },
  {
    slug: 'terminal',
    type: 'recall',
    prompt: `${MARK} A terminal block mixing stdout and a stack trace.`,
    blocks: [
      {
        kind: 'terminal',
        slot: 'context',
        command: 'pnpm test src/window.test.ts',
        lines: [
          { text: '✓ returns 3 for ("eceba", 2)', stream: 'out' },
          { text: '✗ returns 2 for ("aa", 5)', stream: 'err' },
          { text: '    expected 2, received 0', stream: 'err' },
          { text: '1 failed, 1 passed', stream: 'out' },
        ],
      },
    ],
  },
  {
    slug: 'diagram-small',
    type: 'recall',
    prompt: `${MARK} A flow diagram at the minimum — two nodes, one edge.`,
    blocks: [
      {
        kind: 'diagram',
        slot: 'context',
        ...DIAGRAM_SMALL,
        alt: 'A client reading from a cache.',
        svg: renderDiagram(DIAGRAM_SMALL.nodes, DIAGRAM_SMALL.edges),
      },
    ],
  },
  {
    slug: 'diagram-full',
    type: 'recall',
    prompt: `${MARK} A flow diagram at the cap — five nodes, and one edge with no label.`,
    blocks: [
      {
        kind: 'diagram',
        slot: 'context',
        ...DIAGRAM_FULL,
        alt: 'A client writing to a primary that replicates asynchronously to two replicas, while reads go to a cache backed by the first replica.',
        svg: renderDiagram(DIAGRAM_FULL.nodes, DIAGRAM_FULL.edges),
      },
    ],
  },
  {
    slug: 'sequence',
    type: 'recall',
    prompt: `${MARK} A sequence diagram showing a stale read, with a delayed message.`,
    blocks: [
      {
        kind: 'sequence',
        slot: 'context',
        ...SEQUENCE_STALE,
        alt: 'A client writes to the primary, replication is delayed, and a read served by the replica returns the old value.',
        svg: renderSequence(SEQUENCE_STALE.lanes, SEQUENCE_STALE.messages),
      },
    ],
  },
];

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

  // The answer surfaces and the content-block variants, in one list: both are
  // "one card per concept", and the spec does not care which array a case came
  // from — only that every slug it expects turns up exactly once.
  const entries = [
    ...FORMAT_SEEDS.map((seed) => ({ slug: kindOf(seed), type: seed.type, payload: seed.payload })),
    ...CARD_VARIANTS.map((v) => ({
      slug: v.slug,
      type: v.type,
      payload: {
        type: v.type,
        prompt: v.prompt,
        answer: 'the sliding window invariant',
        accept: ['sliding window', 'at most k distinct'],
        blocks: v.blocks,
      },
    })),
  ];
  const kinds = entries.map((e) => e.slug);

  const inserted = await db
    .insert(concepts)
    .values(
      entries.map((entry, i) => ({
        topicId: topic.id,
        slug: entry.slug,
        title: `The ${entry.slug} card`,
        order: i + 1,
        heldOut: false,
        teachMode: 'try_first' as const,
        tryFirstPrompt: `What do you remember about the ${entry.slug} card?`,
        explanationShort: `The ${entry.slug} card, rendered from real data.`,
        explanationLong: `A seeded ${entry.slug} item, so that card can be rendered without a live generation.`,
        corrections: [],
      })),
    )
    .returning({ id: concepts.id, slug: concepts.slug });
  const idBySlug = new Map(inserted.map((r) => [r.slug, r.id]));

  const now = new Date();
  for (const entry of entries) {
    const conceptId = idBySlug.get(entry.slug);
    if (!conceptId) throw new Error(`seedFormatShowcase: no concept for ${entry.slug}`);
    // The gate: what the worker is allowed to store is what gets stored here,
    // so a fixture cannot drift into a shape the generator could never produce.
    const payload: ItemPayload = ItemPayloadSchema.parse(entry.payload);
    await db.insert(items).values({
      conceptId,
      type: entry.type,
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
  // `cards` pairs each slug with the prompt that identifies it on screen: the
  // session never shows a concept slug, so a spec matching on the prompt is
  // how a screenshot gets named after the case it is showing.
  writeFileSync(
    OUT_FILE,
    JSON.stringify(
      {
        userId,
        webSessionToken: session.token,
        topicId: topic.id,
        kinds,
        cards: entries.map((e) => ({ slug: e.slug, prompt: (e.payload as { prompt: string }).prompt })),
      },
      null,
      2,
    ),
  );
  console.log(`seedFormatShowcase: ${kinds.length} concepts (${kinds.join(', ')}), token written to ${OUT_FILE}`);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  await main();
  await pg.end();
}
