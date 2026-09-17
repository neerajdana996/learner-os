import { and, eq, lt, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { topics } from '../../db/schema.js';
import { getGenerationQueue } from '../../workers/queue.js';
import type { GenerationProgress } from '../../workers/generator.worker.js';
import type { TopicCreate } from '@learnos/shared';
import { log } from '../../lib/log.js';
import { jobIsLive, STRANDED_ERROR, strandedCutoff } from '../../lib/stranded.js';
import { findTopic, insertTopic, listTopics } from './topics.repository.js';

/**
 * Creating a topic while one is already generating returns the one that is
 * already building (T-065).
 *
 * The wait screen sits there for five to ten minutes, so a second click is not
 * a rare accident — it happened in dev and cost a second full generation, about
 * eighty model calls. It is worse than wasted money afterwards:
 * `findActiveTopic` takes the oldest active topic, so the learner would work on
 * one and the duplicate would sit there invisible.
 *
 * Scoped to `generating` on purpose. Whether someone may hold two *active*
 * topics is a product question (plan.md §8 puts multi-topic scheduling out of
 * scope for the pilot), not this guard's business.
 *
 * The check and the insert are wrapped in one transaction, serialized per user
 * with a Postgres advisory lock (`pg_advisory_xact_lock`, released automatically
 * at commit). A plain SELECT-then-INSERT left a real gap here: two requests
 * arriving together — a genuine double-click, not two clicks a second apart —
 * both ran the SELECT before either INSERT landed, so both saw "no generating
 * topic" and both created one. Found by an E2E test that actually fires both
 * requests concurrently (`Promise.all`) rather than one after the other.
 */
export async function createTopic(userId: string, body: TopicCreate) {
  // A dead `generating` row must not be what the guard below hands back
  // (T-069). Done here rather than left to the lifecycle tick so the learner's
  // own retry works immediately, and before the transaction, because it asks
  // Redis and a Redis round trip does not belong inside the advisory lock.
  await failStrandedTopics(new Date(), { userId });

  const { topic, isNew } = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);

    const [generating] = await tx
      .select({ id: topics.id, status: topics.status })
      .from(topics)
      .where(and(eq(topics.userId, userId), eq(topics.status, 'generating')));
    if (generating) return { topic: generating, isNew: false };

    const [inserted] = await insertTopic(
      {
        userId,
        title: body.title,
        why: body.why ?? null,
        // Null covers both "didn't say" and "doesn't matter" — T-092 is what
        // tells them apart, by recording that it inferred the one it fills in.
        language: body.language ?? null,
        startsAt: body.startsAt ?? null,
        endsAt: body.endsAt ?? null,
        dailyBudgetMin: body.dailyBudgetMin,
      },
      tx,
    );
    if (!inserted) throw new Error('topic insert returned no row');
    return { topic: inserted, isNew: true };
  });

  // Enqueued after commit, outside the lock: a Redis round trip has no
  // business holding a Postgres advisory lock open, and a job for a topic
  // that didn't really get inserted (isNew: false) must never be queued.
  if (isNew) {
    await getGenerationQueue().add('generate', { topicId: topic.id }, { jobId: topic.id });
  }
  return topic;
}

export type JobStateLookup = (topicId: string) => Promise<string | null>;

/** The generation job's state, or null when there is none. The job id is the topic id. */
async function generationJobState(topicId: string): Promise<string | null> {
  const job = await getGenerationQueue().getJob(topicId);
  return job ? await job.getState() : null;
}

/**
 * Marks `failed` every topic that has been `generating` past the cutoff with no
 * live job behind it (T-069; see `lib/stranded.ts` for the rule and why the
 * recovery is failing rather than retrying). Runs on the per-minute lifecycle
 * tick, and for one user just before `createTopic`'s guard.
 *
 * **When Redis cannot answer, nothing is marked.** An unreachable queue is not
 * evidence that a job is dead, and failing every in-flight generation during a
 * Redis blip would turn a transient outage into lost work for every learner
 * who was waiting.
 *
 * The update re-checks `generating`, so a job that finishes between the lookup
 * and the write keeps the status it just earned.
 */
export async function failStrandedTopics(
  now: Date,
  { userId, jobState = generationJobState }: { userId?: string; jobState?: JobStateLookup } = {},
): Promise<number> {
  const candidates = await db
    .select({ id: topics.id, createdAt: topics.createdAt })
    .from(topics)
    .where(
      and(
        eq(topics.status, 'generating'),
        lt(topics.createdAt, strandedCutoff(now)),
        userId ? eq(topics.userId, userId) : undefined,
      ),
    );

  let failed = 0;
  for (const candidate of candidates) {
    let state: string | null;
    try {
      state = await jobState(candidate.id);
    } catch (error) {
      log.warn('stranded_check_skipped', { topicId: candidate.id, error });
      return failed;
    }
    if (jobIsLive(state)) continue;

    const updated = await db
      .update(topics)
      .set({ status: 'failed', error: STRANDED_ERROR })
      .where(and(eq(topics.id, candidate.id), eq(topics.status, 'generating')))
      .returning({ id: topics.id });
    if (updated.length === 0) continue;

    failed += 1;
    log.warn('topic_stranded', {
      topicId: candidate.id,
      jobState: state,
      ageMs: now.getTime() - candidate.createdAt.getTime(),
    });
  }
  return failed;
}

/**
 * How far generation has got (T-064), read from the job rather than the topic
 * row — see `GenerationProgress` for why persistence stays all-or-nothing.
 *
 * Absent is a normal answer, not an error: the job id is the topic id, and
 * BullMQ eventually evicts completed jobs, so a topic that finished long ago
 * has no job to ask. Redis being unreachable must not turn a topic read into a
 * 500 either — the caller still gets status and counts.
 */
export async function generationProgress(topicId: string): Promise<GenerationProgress | null> {
  try {
    const job = await getGenerationQueue().getJob(topicId);
    const progress = job?.progress;
    return typeof progress === 'object' && progress !== null ? (progress as GenerationProgress) : null;
  } catch {
    return null;
  }
}

export { findTopic, listTopics };
