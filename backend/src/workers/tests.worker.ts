import { and, eq } from 'drizzle-orm';
import { Worker } from 'bullmq';
import { answerKindOf } from '@learnos/shared';
import { db } from '../db/client.js';
import { concepts, items, tests, topics } from '../db/schema.js';
import { generateItems } from '../generator/items.js';
import { env } from '../lib/env.js';
import { isPopupEligible } from '../lib/popupEligible.js';
import { assembleTest, TestAssemblyError } from '../lib/testGen.js';
import { existingTest, testCandidates, testConcepts } from '../modules/tests/tests.repository.js';
import { readyTopic } from '../modules/tests/tests.service.js';

export const TEST_QUEUE = 'cold-tests';
export interface TestJobData { userId: string; topicId: string }

/** On-demand generation belongs in a worker. No teaching content or cards are
 * made for controls. Cache one eligible direct-recall item per held-out concept. */
export async function processTestJob({ userId, topicId }: TestJobData, now = new Date(), rng = Math.random) {
  const { topic, existing } = await readyTopic(userId, topicId, now);
  if (existing) return { testId: existing.id };
  const conceptRows = await testConcepts(userId, topicId, now);
  const candidates = await testCandidates(userId, topicId, now);
  for (const concept of conceptRows.filter((c) => c.heldOut)) {
    if (candidates.some((i) => i.conceptId === concept.id && !i.isTransfer)) continue;
    const generated = await generateItems({ topic: topic.title, concept: concept.title,
      summary: concept.summary ?? '', domain: concept.domain ?? undefined, language: topic.language ?? undefined });
    const chosen = generated.items.find((item) => !item.isTransfer && isPopupEligible(answerKindOf(item.payload.blocks)));
    if (!chosen) throw new TestAssemblyError(`Generator returned no eligible control question for ${concept.id}`);
    await db.transaction(async (tx) => {
      await tx.select({ id: concepts.id }).from(concepts).where(eq(concepts.id, concept.id)).for('update');
      // A redelivered worker may have generated concurrently; keep one cache.
      const fresh = await testCandidates(userId, topicId, now, tx);
      if (!fresh.some((i) => i.conceptId === concept.id && !i.isTransfer))
        await tx.insert(items).values({ conceptId: concept.id, type: chosen.payload.type, payload: chosen.payload,
          answerKind: answerKindOf(chosen.payload.blocks), isTransfer: false });
    });
  }
  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(topics).where(and(eq(topics.id, topicId), eq(topics.userId, userId))).for('update');
    if (!locked) throw new TestAssemblyError('Topic disappeared during test generation');
    const prior = await existingTest(topicId, tx);
    if (prior) return { testId: prior.id };
    const selected = assembleTest(await testConcepts(userId, topicId, now, tx), await testCandidates(userId, topicId, now, tx), rng);
    const [test] = await tx.insert(tests).values({ userId, topicId, kind: 'day30',
      itemIds: selected.map((i) => i.id), createdAt: now }).returning({ id: tests.id });
    if (!test) throw new Error('Test insert returned no row');
    await tx.update(topics).set({ status: 'testing' }).where(eq(topics.id, topicId));
    return { testId: test.id };
  });
}
export function createTestWorker() {
  const worker = new Worker<TestJobData>(TEST_QUEUE, (job) => processTestJob(job.data), {
    connection: { url: env.REDIS_URL }, concurrency: 2,
  });
  worker.on('failed', (job, error) => console.error(`Cold test ${job?.id} failed: ${error.message}`));
  worker.on('error', (error) => console.error('Cold test worker error:', error));
  return worker;
}
