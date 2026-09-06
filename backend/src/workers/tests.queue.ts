import { Queue } from 'bullmq';
import { env } from '../lib/env.js';
import { TEST_QUEUE, type TestJobData } from './tests.worker.js';

let queue: Queue<TestJobData> | undefined;
export function getTestQueue(): Queue<TestJobData> {
  return queue ??= new Queue<TestJobData>(TEST_QUEUE, { connection: { url: env.REDIS_URL } });
}
export async function enqueueTest(data: TestJobData, retryFailed = false) {
  // Retained jobs deduplicate route retries and each minute of lifecycle scans.
  const job = await getTestQueue().add('build', data, { jobId: `day30-${data.topicId}`,
    attempts: 3, backoff: { type: 'exponential', delay: 30_000 } });
  if (retryFailed && await job.getState() === 'failed') {
    try { await job.retry('failed'); } catch (error) {
      // Two explicit retries may race; the one already queued is sufficient.
      if (await job.getState() === 'failed') throw error;
    }
  }
  return { testId: null, jobId: job.id!, state: await job.getState() };
}
export async function closeTestQueue() { await queue?.close(); queue = undefined; }
