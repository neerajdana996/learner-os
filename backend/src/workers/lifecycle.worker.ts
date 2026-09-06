import { and, eq, inArray } from 'drizzle-orm';
import { Queue, Worker } from 'bullmq';
import { TestScoresSchema } from '@learnos/shared';
import { db } from '../db/client.js';
import { topics, users } from '../db/schema.js';
import { env } from '../lib/env.js';
import { getMailTransport } from '../lib/mail.js';
import { testIsDue } from '../lib/testLifecycle.js';
import { existingTest } from '../modules/tests/tests.repository.js';
import { enqueueTest } from './tests.queue.js';

export const LIFECYCLE_QUEUE = 'test-lifecycle';
type LifecycleJob = { event: 'tick' } | { event: 'ready' | 'completed'; testId: string; userId: string; topicId: string };
let queue: Queue<LifecycleJob> | undefined;
export function getLifecycleQueue(): Queue<LifecycleJob> {
  return queue ??= new Queue<LifecycleJob>(LIFECYCLE_QUEUE, { connection: { url: env.REDIS_URL } });
}
/** Poll each minute so local 06:00 works at quarter-hour UTC offsets and after
 * DST changes. Persisted topic/test states make repeated scans harmless. */
export async function processLifecycle(now = new Date()) {
  const rows = await db.select({ topic: topics, timezone: users.timezone }).from(topics)
    .innerJoin(users, eq(users.id, topics.userId)).where(inArray(topics.status, ['active', 'holdout', 'testing', 'done']));
  for (const { topic, timezone } of rows) {
    if (topic.status === 'active' && topic.endsAt && topic.endsAt <= now) {
      await db.update(topics).set({ status: 'holdout' }).where(and(eq(topics.id, topic.id), eq(topics.status, 'active')));
    }
    if (testIsDue(topic, timezone, now)) await enqueueTest({ userId: topic.userId, topicId: topic.id });
    const test = await existingTest(topic.id);
    if (!test) continue;
    const event = TestScoresSchema.safeParse(test.scores).success ? 'completed' : 'ready';
    await getLifecycleQueue().add('notify', { event, testId: test.id, userId: topic.userId, topicId: topic.id }, {
      jobId: `${event}-${test.id}`, attempts: 5, backoff: { type: 'exponential', delay: 60_000 },
    });
  }
}
export async function processLifecycleJob(data: LifecycleJob) {
  if (data.event === 'tick') return processLifecycle();
  const [row] = await db.select({ email: users.email, title: topics.title }).from(topics)
    .innerJoin(users, eq(users.id, topics.userId))
    .where(and(eq(topics.id, data.topicId), eq(topics.userId, data.userId)));
  const test = await existingTest(data.topicId);
  if (!row || !test || test.id !== data.testId) return;
  // Suppress a delayed ready message after the learner has already finished.
  if (data.event === 'ready' && TestScoresSchema.safeParse(test.scores).success) return;
  await getMailTransport().send({ to: row.email,
    subject: data.event === 'ready' ? 'Your learnos recall check is ready' : 'Your learnos recall check is complete',
    text: data.event === 'ready'
      ? `Your recall check for ${row.title} is ready. Allow up to 20 minutes and answer without reviewing first.\n\n${env.APP_URL}/tests/${test.id}`
      : `Thanks for completing the recall check for ${row.title}. Your results are available here:\n\n${env.APP_URL}/tests/${test.id}`,
  });
}
export async function startLifecycle() {
  await getLifecycleQueue().upsertJobScheduler('local-lifecycle', { every: 60_000 }, {
    name: 'tick', data: { event: 'tick' }, opts: { removeOnComplete: 10, removeOnFail: 50 },
  });
  const worker = new Worker<LifecycleJob>(LIFECYCLE_QUEUE, (job) => processLifecycleJob(job.data), { connection: { url: env.REDIS_URL } });
  worker.on('failed', (job, error) => console.error(`Lifecycle ${job?.id} failed: ${error.message}`));
  worker.on('error', (error) => console.error('Lifecycle worker error:', error));
  return worker;
}
export async function closeLifecycleQueue() { await queue?.close(); queue = undefined; }
