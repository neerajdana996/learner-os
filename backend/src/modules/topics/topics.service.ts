import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { topics } from '../../db/schema.js';
import { getGenerationQueue } from '../../workers/queue.js';
import type { GenerationProgress } from '../../workers/generator.worker.js';
import type { TopicCreate } from '@learnos/shared';
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
 */
export async function createTopic(userId: string, body: TopicCreate) {
  const [generating] = await db
    .select({ id: topics.id, status: topics.status })
    .from(topics)
    .where(and(eq(topics.userId, userId), eq(topics.status, 'generating')));
  if (generating) return generating;

  const [topic] = await insertTopic({
    userId,
    title: body.title,
    why: body.why ?? null,
    // Null covers both "didn't say" and "doesn't matter" — T-092 is what tells
    // them apart, by recording that it inferred the one it fills in.
    language: body.language ?? null,
    startsAt: body.startsAt ?? null,
    endsAt: body.endsAt ?? null,
    dailyBudgetMin: body.dailyBudgetMin,
  });
  if (!topic) throw new Error('topic insert returned no row');
  await getGenerationQueue().add('generate', { topicId: topic.id }, { jobId: topic.id });
  return topic;
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
