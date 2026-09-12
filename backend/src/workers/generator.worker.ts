// Generation job: topic title in → validated concept map + practice items
// persisted, topic flipped to `active`. plan.md §5: the model API is only
// ever called from here, never from a route or a client.
import { eq } from 'drizzle-orm';
import { Worker } from 'bullmq';
import { db } from '../db/client.js';
import { concepts, conceptPrereqs, items, topics } from '../db/schema.js';
import { generateConceptMap } from '../generator/conceptMap.js';
import { generateFraming, formatSpine } from '../generator/framing.js';
import { generateItemsBatch, SPLITTABLE_BATCH_REASONS, type GeneratedItem } from '../generator/items.js';
import { generateTeaching } from '../generator/teaching.js';
import { GenerationError } from '../generator/errors.js';
import { pickHeldOut, seededRng, HELD_OUT_RATIO, HELD_OUT_MIN_ORDER } from '../lib/heldOut.js';
import { teachModeFor } from '../lib/teachMode.js';
import { env } from '../lib/env.js';
import { collectUsage } from '../llm/usage.js';
import { collectWarnings } from '../generator/severity.js';
import { LlmError } from '../llm/errors.js';
import { answerKindOf } from '@learnos/shared';

export const GENERATION_QUEUE = 'generation';

export interface GenerationJobData {
  topicId: string;
}

/**
 * What the onboarding wait screen shows while the job runs (T-064).
 *
 * It is reported through BullMQ's own job progress rather than written to the
 * topic row, because persistence here is deliberately all-or-nothing: T-007
 * writes every concept, item and explanation in one transaction at the end, and
 * `getSession` relies on that to treat a concept without items as a bug rather
 * than a race. Streaming partial rows in to animate a counter would trade a
 * real invariant for a progress bar.
 *
 * `total` is known once the map returns: one call per non-held-out concept for
 * items, and one for teaching.
 */
export interface GenerationProgress {
  stage: 'map' | 'content' | 'saving';
  completed: number;
  total: number;
  /** What is being worked on right now, for the wait screen's subtitle. */
  concept?: string;
}

export type ProgressReporter = (progress: GenerationProgress) => void | Promise<void>;

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`generation: ${what}`);
  return value;
}

/**
 * The whole job. Generation happens first and the DB transaction is opened only
 * once every model call has returned — holding a transaction open across
 * dozens of slow API calls would pin a connection for minutes.
 *
 * On any failure the topic is marked `failed` with the reason and the error is
 * rethrown so BullMQ records the job as failed too.
 */
export async function processGenerationJob(
  { topicId }: GenerationJobData,
  rng: () => number = Math.random,
  // A callback rather than the BullMQ `job`: the tests and the Sprint
  // integration walks call this function directly, and they should not have to
  // build a queue to run a generation.
  onProgress: ProgressReporter = () => {},
): Promise<void> {
  const [topic] = await db.select().from(topics).where(eq(topics.id, topicId));
  if (!topic) throw new Error(`generation: topic ${topicId} not found`);

  // Wrapped so the whole job reports one cost line. Without it nobody could
  // answer "what does a topic cost?", which is the number that decides whether
  // per-learner generated topics are viable at all (T-058, T-074).
  const { result: { calls, usd }, warnings } = await collectWarnings(async () =>
    collectUsage(async () => {
  try {
    // Scoping first (T-161). The learner's own `why` was collected at
    // onboarding, written to the topic row, and then read by nothing — so the
    // course was identical whether they wanted an overview or were debugging a
    // production incident. Reported under `map` rather than as its own stage:
    // "working out the concepts" covers it from the learner's side, and adding
    // a stage would mean a shared-schema and frontend change for a phase that
    // lasts seconds.
    await onProgress({ stage: 'map', completed: 0, total: 1 });
    const framing = await generateFraming({
      topic: topic.title,
      why: topic.why ?? undefined,
      language: topic.language ?? undefined,
    });

    const map = await generateConceptMap(framing, topic.language ?? undefined);
    // The generator returns concepts in teaching order; `order` is 1-based.
    const indexed = map.concepts.map((concept, index) => ({ ...concept, order: index + 1 }));
    const crux = new Set(map.crux);
    const heldOut = pickHeldOut(indexed, HELD_OUT_RATIO, HELD_OUT_MIN_ORDER, rng, crux);

    // teach_mode is decided here rather than at insert time because the
    // teaching prompt is conditioned on it — an `example_first` concept needs a
    // worked example in its explanation (T-053).
    //
    // **Derived, not drawn** (T-161). This was `rng() < 0.5`, which settled the
    // most consequential pedagogical choice per concept by coin flip and so got
    // it wrong on about half of every map. `teachModeFor` reads the map's own
    // `hardBecause` — see `lib/teachMode.ts` for why each value maps where it
    // does.
    const ordered = indexed.map((concept) => ({
      ...concept,
      heldOut: heldOut.has(concept.slug),
      teachMode: teachModeFor(concept.hardBecause),
    }));

    /**
     * **Every concept gets items. Only taught concepts get teaching content.**
     *
     * Held-out concepts are never taught and never reviewed (plan.md §6), but
     * they *are* the control arm, and a control arm the Day-30 test cannot ask
     * about measures nothing. The previous version skipped them entirely on the
     * strength of a comment saying T-038 would "generate an item for them on
     * demand" — T-038 never did, `assembleTest` throws
     * `Missing eligible held-out question` without one, and every topic in the
     * database was therefore incapable of producing a Day-30 test (T-120).
     *
     * Generating them here rather than at test time is deliberate: assembling a
     * surprise test must not depend on an LLM call succeeding while the learner
     * waits, and the item generator needs only the map's title and summary, so
     * there is nothing to wait for.
     *
     * Teaching content is still skipped for a held-out concept. One with
     * an explanation is one accidental render away from being taught.
     */
    const itemsBySlug = new Map<string, GeneratedItem[]>();
    const teachingBySlug = new Map<string, Awaited<ReturnType<typeof generateTeaching>>>();
    let completed = 0;
    await onProgress({ stage: 'content', completed, total: ordered.length });

    const spine = formatSpine(framing.spine);

    /**
     * Items first, in batches of neighbouring concepts (T-162).
     *
     * One call per concept could not see its neighbours, so it could not tell
     * them apart — the same question arrived for two adjacent concepts, and the
     * "discriminate this from its neighbour" item the prompt has always asked
     * for was unwritable. A batch shares one domain fragment and is capped at
     * four so the response stays well inside the token limit.
     *
     * `asked` accumulates across batches so later ones do not repeat or give
     * away what earlier ones already asked.
     */
    const asked: string[] = [];

    /** Built per call rather than once, so each one picks up the prompts every
     *  earlier call added to `asked`. */
    const itemsInput = (group: typeof ordered) => ({
      topic: topic.title,
      level: framing.level,
      spine,
      // Every concept in a batch shares this — see `batchConcepts`.
      domain: group[0]?.domain,
      concepts: group.map((concept) => ({
        slug: concept.slug,
        title: concept.title,
        summary: concept.summary ?? '',
        misconceptions: concept.misconceptions,
      })),
      // Not the batch's own slugs: when `group` is a single concept during a
      // fallback, its former batch-mates become neighbours, which is what they
      // are — and exactly what a discrimination item needs.
      neighbours: formatNeighbours(ordered, new Set(group.map((c) => c.slug))),
      asked: asked.map((prompt) => `- ${prompt}`).join('\n'),
      // Null means the learner didn't name one, so nothing is asked for and
      // each call decides for itself as it always has (T-091).
      language: topic.language ?? undefined,
    });

    const take = (generated: Awaited<ReturnType<typeof generateItemsBatch>>) => {
      for (const [slug, items] of generated.bySlug) {
        itemsBySlug.set(slug, items);
        for (const item of items) asked.push(item.payload.prompt);
      }
    };

    for (const batch of batchConcepts(ordered)) {
      try {
        take(await generateItemsBatch(itemsInput(batch)));
      } catch (error) {
        /**
         * One concept's broken rule used to cost the whole course (T-164).
         *
         * `runPrompt` already retries a batch once; when the second attempt
         * breaks a rule too, the job threw and the transaction — which opens
         * only after every model call has returned — took every batch that had
         * already succeeded down with it. Five minutes and a real bill, for one
         * concept that forgot to mark a transfer item.
         *
         * So a batch that fails on a content rule is re-run one concept at a
         * time. The rules are unchanged and nothing is skipped: a single
         * concept that still fails ends the job, because a concept with no
         * items cannot be taught and a course missing one is not the course the
         * map described.
         */
        const splittable =
          batch.length > 1 &&
          error instanceof GenerationError &&
          SPLITTABLE_BATCH_REASONS.has(error.reason);
        if (!splittable) throw error;

        console.warn(
          `items: batch of ${batch.length} failed (${(error as GenerationError).reason}), ` +
            `retrying one concept at a time — ${batch.map((c) => c.slug).join(', ')}`,
        );
        for (const concept of batch) {
          take(await generateItemsBatch(itemsInput([concept])));
        }
      }
    }

    /**
     * Then teaching, one concept at a time and given that concept's items.
     *
     * Backward design (T-162): the explanation exists to make those questions
     * answerable three weeks later, and until now it was written without ever
     * seeing them — they were generated four lines earlier in this same loop
     * and discarded.
     *
     * Not for a held-out concept: an explanation that exists is an explanation
     * something can render, and the control arm's whole value is that the
     * learner never saw it.
     */
    for (const concept of ordered) {
      if (!concept.heldOut) {
        teachingBySlug.set(
          concept.slug,
          await generateTeaching({
            topic: topic.title,
            level: framing.level,
            concept: concept.title,
            summary: concept.summary ?? '',
            teachMode: concept.teachMode,
            spine,
            misconceptions: concept.misconceptions.map((m) => `- ${m}`).join('\n'),
            items: formatItemsForTeaching(itemsBySlug.get(concept.slug) ?? []),
            prereqs: formatConceptLines(ordered.filter((c) => concept.prereqs.includes(c.slug))),
            notYetTaught: formatConceptLines(ordered.filter((c) => c.order > concept.order)),
            language: topic.language ?? undefined,
            // Selects the teaching fragment (T-145) — same rule as the items
            // call: only an exact 'code' or 'systems' gets one.
            domain: concept.domain,
          }),
        );
      }

      completed += 1;
      await onProgress({
        stage: 'content',
        completed,
        total: ordered.length,
        concept: concept.title,
      });
    }

    await onProgress({ stage: 'saving', completed: ordered.length, total: ordered.length });

    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(concepts)
        .values(
          ordered.map((concept) => {
            const teaching = teachingBySlug.get(concept.slug);
            return {
              topicId,
              slug: concept.slug,
              title: concept.title,
              summary: concept.summary,
              order: concept.order,
              heldOut: concept.heldOut,
              teachMode: concept.teachMode,
              // Decided once in the map pass (T-082) and read by every format
              // decision downstream — T-083 appends `domains/code.md` only for
              // a `code` concept.
              domain: concept.domain,
              // Null for held-out concepts, which are never taught.
              tryFirstPrompt: teaching?.tryFirstPrompt ?? null,
              explanationShort: teaching?.explanationShort ?? null,
              explanationLong: teaching?.explanationLong ?? null,
              corrections: teaching?.corrections ?? [],
              // Null for a held-out concept (no `teaching` at all) and for
              // every concept whose fragment declined to write one — the
              // common case even for code/systems concepts (T-145).
              teachBlock: teaching?.teachBlock ?? null,
            };
          }),
        )
        .returning({ id: concepts.id, slug: concepts.slug });

      const idBySlug = new Map(inserted.map((row) => [row.slug, row.id]));

      const prereqRows = ordered.flatMap((concept) => {
        const conceptId = required(idBySlug.get(concept.slug), `missing id for ${concept.slug}`);
        // Dedupe: the same prereq listed twice would violate the composite PK
        // and roll back the whole map.
        return [...new Set(concept.prereqs)].map((prereq) => ({
          conceptId,
          prerequisiteConceptId: required(idBySlug.get(prereq), `missing id for prereq ${prereq}`),
        }));
      });
      if (prereqRows.length > 0) await tx.insert(conceptPrereqs).values(prereqRows);

      const itemRows = [...itemsBySlug].flatMap(([slug, list]) => {
        const conceptId = required(idBySlug.get(slug), `missing id for ${slug}`);
        return list.map((item) => ({
          conceptId,
          type: item.payload.type,
          payload: item.payload,
          // Denormalised out of the payload for the one query that cannot read
          // JSON: the extension's due-item pick (T-079's column, T-089's
          // filter). Null for a plain prompt, which is every item today.
          answerKind: answerKindOf(item.payload.blocks),
          isTransfer: item.isTransfer,
        }));
      });
      if (itemRows.length > 0) await tx.insert(items).values(itemRows);

      await tx.update(topics).set({ status: 'active', error: null }).where(eq(topics.id, topicId));
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // Always logged server-side (T-157, same reasoning as app.ts's T-154): the
    // topic row only ever got `error.message`, and for an `LlmError` that is a
    // generic "response did not match schema" — the raw model output that
    // would actually explain the failure was thrown away, so a real generation
    // failure was undiagnosable without paying to reproduce it.
    console.error(`generation ${topicId} failed:`, error);
    const raw = error instanceof LlmError || error instanceof GenerationError ? error.raw : undefined;
    if (raw) console.error(`generation ${topicId} raw model response:\n${raw}`);
    // Outside the transaction on purpose — inside, this update would roll back
    // along with everything else and the topic would be stuck on `generating`.
    await db.update(topics).set({ status: 'failed', error: reason }).where(eq(topics.id, topicId));
    throw error;
  }
  }),
  );

  console.log(
    `generation ${topicId} "${topic.title}": ${calls.length} model calls, ` +
      `${calls.reduce((n, c) => n + c.prompt, 0)} in / ${calls.reduce((n, c) => n + c.completion, 0)} out tokens, ` +
      `$${usd.toFixed(3)}, ${(calls.reduce((n, c) => n + c.ms, 0) / 1000).toFixed(0)}s of model time`,
  );

  /**
   * The rules this course bent to exist at all (T-164).
   *
   * Printed beside the cost because that is where someone looks after a
   * generation, and because it is the hand-review list for content QA (T-045):
   * these are the concepts whose question set or lesson came out thinner than
   * the prompt asked for. Logged rather than stored — a column for them is a
   * schema change, and belongs with T-095's `topics.metadata`.
   */
  if (warnings.length > 0) {
    console.warn(
      `generation ${topicId} "${topic.title}": ${warnings.length} rule(s) tolerated — ` +
        warnings.map((w) => `${w.prompt}/${w.reason}`).join(', '),
    );
  }
}

/**
 * How many concepts share one item-generation call (T-162).
 *
 * Four, not the whole domain group. The value of a batch is that the model can
 * see the neighbours it has to differentiate from; the cost is output length,
 * and eight concepts at 6–8 items each runs at the edge of the token limit
 * where `truncated` starts being the failure mode.
 */
const MAX_BATCH = 4;

/**
 * Groups concepts into item-generation batches, by `domain`, in map order.
 *
 * Domain and not prereq-adjacency because `domains/<d>.md` is appended per
 * call: a mixed batch would need two fragments telling the model "this concept
 * is code" and "this concept is systems" at the same time. Grouping by domain
 * keeps that mechanism intact, and concepts in one domain are already the ones
 * most at risk of blurring into each other.
 *
 * Map order is preserved inside each group, so neighbours land in the same
 * batch wherever the grouping allows it.
 */
export function batchConcepts<T extends { domain: string }>(concepts: readonly T[]): T[][] {
  const byDomain = new Map<string, T[]>();
  for (const concept of concepts) {
    const list = byDomain.get(concept.domain);
    if (list) list.push(concept);
    else byDomain.set(concept.domain, [concept]);
  }

  const batches: T[][] = [];
  for (const list of byDomain.values()) {
    for (let i = 0; i < list.length; i += MAX_BATCH) {
      batches.push(list.slice(i, i + MAX_BATCH));
    }
  }
  return batches;
}

interface ConceptLine {
  slug: string;
  title: string;
  summary: string | null;
}

/** `- slug: Title — summary`, the form every prompt reads a concept list in. */
function formatConceptLines(concepts: readonly ConceptLine[]): string {
  return concepts.map((c) => `- ${c.slug}: ${c.title} — ${c.summary ?? ''}`).join('\n');
}

/** Every concept in the course except the ones this batch is writing for —
 *  what makes a discrimination item possible, and what keeps a batch from
 *  wandering into ground another concept already covers. */
function formatNeighbours(all: readonly ConceptLine[], inBatch: ReadonlySet<string>): string {
  return formatConceptLines(all.filter((c) => !inBatch.has(c.slug)));
}

/**
 * The questions, rendered for the teaching prompt to read.
 *
 * Answers included deliberately: the explanation has to make them *derivable*,
 * and a model that can see only the prompts has to guess what counts as right.
 * Server-side only — this never leaves the generator.
 */
function formatItemsForTeaching(items: readonly GeneratedItem[]): string {
  return items
    .map(({ payload }) => {
      const head = `- [${payload.type}] ${payload.prompt}`;
      switch (payload.type) {
        case 'recall':
        case 'application':
          return `${head}\n  Answer: ${payload.answer}`;
        case 'recognition':
          return `${head}\n  Answer: ${payload.options[payload.answerIndex] ?? ''}`;
        case 'explain':
          return `${head}\n  Rubric: ${payload.rubric}`;
      }
    })
    .join('\n');
}

export { seededRng };

/**
 * Constructed by the process entrypoint, never at import time — building it
 * here would open a Redis connection in every test that imports this module.
 */
export function createGenerationWorker(): Worker<GenerationJobData> {
  return new Worker<GenerationJobData>(
    GENERATION_QUEUE,
    async (job) => processGenerationJob(job.data, Math.random, (progress) => job.updateProgress(progress)),
    { connection: { url: env.REDIS_URL } },
  );
}
