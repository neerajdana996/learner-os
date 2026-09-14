/**
 * One answerable item per answer-block kind (T-140).
 *
 * **Why this exists.** The dev database holds ~1,400 items across four plain
 * types and *not one* carrying a `blocks` array, because `pnpm seed` reads
 * `backend/fixtures`, which predate Sprint 5. So every Sprint 5 answer surface
 * — `clozeCode`, `hotspotLine`, `orderLines`, `codeEditor`, `numeric` — is
 * built and unit-tested and has never been rendered from real data by
 * anything. The E2E format suite (T-138) needs data before it can prove
 * otherwise, and generating a live code topic costs ~$0.46 and nine minutes
 * per run.
 *
 * **This is not a substitute for confirming the generator emits blocks.** That
 * is the other half of T-140 and it needs a live generation. What this gives
 * is a deterministic, free way to prove the *rendering and grading* path works
 * for each format.
 *
 * Every payload goes through `ItemPayloadSchema` before it is written, so this
 * script cannot drift from what the worker is allowed to store — if the schema
 * tightens, this fails loudly rather than seeding something unrenderable.
 */
import { eq } from 'drizzle-orm';
import { ItemPayloadSchema, answerKindOf, type ItemPayload } from '@learnos/shared';
import { db } from '../db/client.js';
import { concepts, items, topics, users } from '../db/schema.js';

const DEV_EMAIL = 'dev@learnos.local';

/** Marks every item this script writes, so a re-run replaces its own rows
 *  rather than piling up a new set beside the last one. */
const MARKER = '[fmt]';

/**
 * `type` lives inside the payload — `ItemPayloadSchema` is a discriminated
 * union on it — and is copied to the column, which is why it appears twice.
 *
 * **`recognition` and `explain` are absent on purpose.** Neither may carry an
 * answer block: recognition grades by index and explain against a rubric, and
 * neither can grade a hole or a clicked line. So the formats below are all
 * `recall` or `application` — the schema telling us something true about the
 * product rather than an inconvenience to route around.
 */
type Seed = { type: 'recall' | 'application'; payload: unknown };

/**
 * Exported so `seedFormatShowcase.ts` can place **one** of these per concept.
 * All five on a single concept is right for this script — it is proving the
 * payloads store — but the scheduler serves one item per due concept, so a
 * spec that wants to *see* every format needs them spread out. One array, so
 * the two arrangements cannot drift.
 */
export const FORMAT_SEEDS: Seed[] = [
  // ---- clozeCode: the cheap answer surface (T-086)
  {
    type: 'recall',
    payload: {
      type: 'recall',
      prompt: `${MARKER} Fill in what makes this effect run only once.`,
      answer: '[]',
      blocks: [
        {
          kind: 'clozeCode',
          slot: 'answer',
          lang: 'typescript',
          src: 'useEffect(() => {\n  subscribe();\n}, {{1}});',
          holes: [{ id: 1, answer: '[]', accept: ['[ ]'], width: 4 }],
          failure: 'Omitting it re-subscribes on every render.',
        },
      ],
    },
  },

  // ---- hotspotLine: click the line that is wrong (T-087)
  {
    type: 'recall',
    payload: {
      type: 'recall',
      prompt: `${MARKER} Click the line that makes this loop never terminate.`,
      answer: '2',
      blocks: [
        {
          kind: 'hotspotLine',
          slot: 'answer',
          lang: 'typescript',
          src: 'let left = 0;\nwhile (left < n) {\n  count += 1;\n}',
          line: 2,
          why: 'Nothing advances `left`, so the condition never changes.',
          failure: 'With n = 1 this loop runs forever.',
          acceptAdjacent: true,
        },
      ],
    },
  },

  // ---- orderLines: put the lines in order (T-114)
  {
    type: 'application',
    payload: {
      type: 'application',
      prompt: `${MARKER} Put these lines in the order that makes the window shrink correctly.`,
      answer: '0,1,2,3',
      blocks: [
        {
          kind: 'orderLines',
          slot: 'answer',
          lang: 'typescript',
          lines: [
            'counts[s[right]] += 1;',
            'while (counts.size > k) {',
            '  counts[s[left]] -= 1;',
            '  left += 1;',
          ],
          order: [0, 1, 2, 3],
          swapBreaks: 'Swapping the last two decrements a character the window no longer holds.',
        },
      ],
    },
  },

  // ---- numeric: a number, judged with a tolerance (T-118)
  {
    type: 'application',
    payload: {
      type: 'application',
      prompt: `${MARKER} A sliding window over 1,000 characters with k = 3. How many times is each character visited, at most?`,
      answer: '2',
      blocks: [
        { kind: 'numeric', slot: 'answer', answer: 2, tolerance: 0.1, unit: 'visits' },
      ],
    },
  },

  // ---- codeEditor: write the code (T-088). Served in the panel and as a
  //      review since T-171; still barred from the day-30 test (T-093).
  {
    type: 'application',
    payload: {
      type: 'application',
      prompt: `${MARKER} Write a function that returns the length of the longest substring with at most k distinct characters.`,
      answer: 'a sliding window with a count map',
      blocks: [
        {
          kind: 'codeEditor',
          slot: 'answer',
          lang: 'typescript',
          signature: 'longest(s: string, k: number): number',
          starter: 'function longest(s, k) {\n  // your code here\n}',
          skeleton: 'function longest(s, k) {\n  let left = 0;\n  // advance right, shrink while distinct > k\n}',
          whyWhole: 'The shrink condition is the whole idea; a blank would only test the keyword.',
          cases: [
            { name: 'two distinct characters', call: 'longest("eceba", 2)', expect: '3' },
            { name: 'k larger than the string', call: 'longest("aa", 5)', expect: '2' },
          ],
        },
      ],
    },
  },
];

/**
 * Writes the five format items onto one already-resolved concept.
 *
 * Exported so `seedMatrix.ts` (E2E-015) can aim this at a concept it just
 * built for a different user, rather than this script owning a hardcoded
 * assumption that the dev learner's topic is the only place format items ever
 * belong.
 */
export async function seedFormatsFor(conceptId: string): Promise<number> {
  // Replace this function's own previous rows on this concept.
  const existing = await db.select().from(items).where(eq(items.conceptId, conceptId));
  const mine = existing.filter((row) => {
    const payload = row.payload as { prompt?: string };
    return typeof payload.prompt === 'string' && payload.prompt.startsWith(MARKER);
  });
  for (const row of mine) await db.delete(items).where(eq(items.id, row.id));

  let written = 0;
  for (const seed of FORMAT_SEEDS) {
    // The gate: what the worker is allowed to store is what gets stored here.
    const payload: ItemPayload = ItemPayloadSchema.parse(seed.payload);
    await db.insert(items).values({
      conceptId,
      type: seed.type,
      payload,
      answerKind: answerKindOf(payload.blocks ?? []),
      isTransfer: false,
    });
    written += 1;
  }
  return written;
}

async function main(): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.email, DEV_EMAIL)).limit(1);
  if (!user) throw new Error(`no ${DEV_EMAIL} — run \`pnpm seed\` first`);

  const [topic] = await db.select().from(topics).where(eq(topics.userId, user.id)).limit(1);
  if (!topic) throw new Error('no topic for the dev learner — run `pnpm seed` first');

  // A *taught*, not-held-out concept: an item on an untaught concept is never
  // served, and one on a held-out concept would be a queue entry `/due`
  // silently drops — which looks exactly like this script not working.
  const taught = await db
    .select()
    .from(concepts)
    .where(eq(concepts.topicId, topic.id));
  const target = taught.find((c) => !c.heldOut);
  if (!target) throw new Error('every concept in this topic is held out');

  const written = await seedFormatsFor(target.id);

  console.log(`\nseeded ${written} format items on "${target.title}" (${target.id})`);
  console.log(`  kinds: ${FORMAT_SEEDS.map((s) => (s.payload as { blocks: { kind: string }[] }).blocks[0]?.kind).join(', ')}\n`);
  process.exit(0);
}

// Only when run as a script. `seedMatrix.ts` (E2E-015) imports
// `seedFormatsFor` directly, and that import must not itself run this file's
// own main() as a side effect — the same guard `seed.ts` uses.
import { fileURLToPath as toPath } from 'node:url';
const invokedDirectly = process.argv[1] && toPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
