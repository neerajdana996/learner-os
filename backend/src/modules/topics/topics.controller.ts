import type { Request, Response } from 'express';
import { userId } from '../../middleware/auth.js';
import { createTopic, findTopic, generationProgress, listTopics } from './topics.service.js';

export async function postTopic(req: Request, res: Response) {
  const topic = await createTopic(userId(req), req.body);
  res.status(202).json({ topicId: topic.id, status: topic.status });
}

export async function getTopics(req: Request, res: Response) {
  const rows = await listTopics(userId(req));
  // Nested to match GET /topics/:id exactly, so one client-side type describes
  // both responses and the dashboard can read a list entry the same way it
  // reads a single topic (T-072).
  res.json({
    topics: rows.map(({ concepts, items, ...topic }) => ({
      ...topic,
      counts: { concepts, items },
    })),
  });
}

export async function getTopic(req: Request, res: Response) {
  const result = await findTopic(userId(req), req.params.id as string);
  if (!result) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const { topic, counts } = result;
  // Only while it is actually building: a finished topic has no job left to
  // ask, and a progress field that lingers would read as "still working".
  const progress = topic.status === 'generating' ? await generationProgress(topic.id) : null;
  res.json({ ...topic, counts, progress });
}