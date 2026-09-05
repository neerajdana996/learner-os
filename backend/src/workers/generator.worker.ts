// Generation job: topic title in → validated concept map + practice items
// persisted, topic flipped to `active`. plan.md §5: the model API is only
// ever called from here, never from a route or a client.
import { eq } from 'drizzle-orm';
import { Worker } from 'bullmq';
import { db } from '../db/client.js';
import { concepts, conceptPrereqs, items, topics } from '../db/schema.js';
import { generateConceptMap } from '../generator/conceptMap.js';
import { generateItems } from '../generator/items.js';
import { generateTeaching } from '../generator/teaching.js';
import { pickHeldOut, seededRng, HELD_OUT_RATIO, HELD_OUT_MIN_ORDER } from '../lib/heldOut.js';
import { env } from '../lib/env.js';
import { collectUsage } from '../llm/usage.js';
import { answerKindOf } from '../shared/index.js';

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
  const { calls, usd } = await collectUsage(async () => {
  try {
    await onProgress({ stage: 'map', completed: 0, total: 1 });
    const map = await generateConceptMap(topic.title);
    // The generator returns concepts in teaching order; `order` is 1-based.
    const indexed = map.concepts.map((concept, index) => ({ ...concept, order: index + 1 }));
    const heldOut = pickHeldOut(indexed, HELD_OUT_RATIO, HELD_OUT_MIN_ORDER, rng);

    // teach_mode is drawn here rather than at insert time because the teaching
    // prompt is conditioned on it — an `example_first` concept needs a worked
    // example in its explanation (T-053). Randomised per concept so T-040 can
    // compare delayed recall between the two modes (plan.md §6, §7).
    const ordered = indexed.map((concept) => ({
      ...concept,
      heldOut: heldOut.has(concept.slug),
      teachMode: (rng() < 0.5 ? 'try_first' : 'example_first') as 'try_first' | 'example_first',
    }));

    // Held-out concepts are never taught or reviewed, so they get neither items
    // nor teaching content (plan.md §6). They still appear in tests, where
    // T-038 generates an item for them on demand.
    const itemsBySlug = new Map<string, Awaited<ReturnType<typeof generateItems>>['items']>();
    const teachingBySlug = new Map<string, Awaited<ReturnType<typeof generateTeaching>>>();
    const teachable = ordered.filter((concept) => !concept.heldOut);
    let completed = 0;
    await onProgress({ stage: 'content', completed, total: teachable.length });

    for (const concept of teachable) {
      // Topic and summary, not just the title: an ambiguous concept name
      // otherwise gets items from the wrong domain entirely (T-FIX-006).
      const generated = await generateItems({
        topic: topic.title,
        concept: concept.title,
        summary: concept.summary ?? '',
        // Null means the learner didn't name one, so nothing is asked for and
        // each call decides for itself as it always has (T-091).
        language: topic.language ?? undefined,
      });
      itemsBySlug.set(concept.slug, generated.items);
      teachingBySlug.set(
        concept.slug,
        await generateTeaching({
          topic: topic.title,
          concept: concept.title,
          summary: concept.summary ?? '',
          teachMode: concept.teachMode,
          language: topic.language ?? undefined,
        }),
      );
      completed += 1;
      await onProgress({
        stage: 'content',
        completed,
        total: teachable.length,
        concept: concept.title,
      });
    }

    await onProgress({ stage: 'saving', completed: teachable.length, total: teachable.length });

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
              // Null for held-out concepts, which are never taught.
              tryFirstPrompt: teaching?.tryFirstPrompt ?? null,
              explanationShort: teaching?.explanationShort ?? null,
              explanationLong: teaching?.explanationLong ?? null,
              corrections: teaching?.corrections ?? [],
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
    // Outside the transaction on purpose — inside, this update would roll back
    // along with everything else and the topic would be stuck on `generating`.
    await db.update(topics).set({ status: 'failed', error: reason }).where(eq(topics.id, topicId));
    throw error;
  }
  });

  console.log(
    `generation ${topicId} "${topic.title}": ${calls.length} model calls, ` +
      `${calls.reduce((n, c) => n + c.prompt, 0)} in / ${calls.reduce((n, c) => n + c.completion, 0)} out tokens, ` +
      `$${usd.toFixed(3)}, ${(calls.reduce((n, c) => n + c.ms, 0) / 1000).toFixed(0)}s of model time`,
  );
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
