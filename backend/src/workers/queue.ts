import { Queue } from 'bullmq';
import { env } from '../lib/env.js';
import { GENERATION_QUEUE, type GenerationJobData } from './generator.worker.js';

let generationQueue: Queue<GenerationJobData> | undefined;

/**
 * Lazily constructed: `new Queue(...)` opens a Redis connection immediately, and
 * this module is imported transitively by the topics route, so building it at
 * import time would connect in every test that touches the Express app.
 */
export function getGenerationQueue(): Queue<GenerationJobData> {
  generationQueue ??= new Queue<GenerationJobData>(GENERATION_QUEUE, {
    connection: { url: env.REDIS_URL },
  });
  return generationQueue;
}

/** Lets tests and a graceful shutdown release the Redis connection. */
export async function closeGenerationQueue(): Promise<void> {
  await generationQueue?.close();
  generationQueue = undefined;
}
