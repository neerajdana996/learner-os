import { getGenerationQueue } from '../../workers/queue.js';
import type { TopicCreate } from '../../shared/index.js';
import { findTopic, insertTopic, listTopics } from './topics.repository.js';

export async function createTopic(userId: string, body: TopicCreate) {
  const [topic] = await insertTopic({
    userId,
    title: body.title,
    why: body.why ?? null,
    startsAt: body.startsAt ?? null,
    endsAt: body.endsAt ?? null,
    dailyBudgetMin: body.dailyBudgetMin,
  });
  if (!topic) throw new Error('topic insert returned no row');
  await getGenerationQueue().add('generate', { topicId: topic.id }, { jobId: topic.id });
  return topic;
}

export { findTopic, listTopics };