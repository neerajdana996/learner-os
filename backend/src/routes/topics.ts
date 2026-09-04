import { Router } from 'express';
import { and, count, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { concepts, items, topics } from '../db/schema.js';
import { validate } from '../lib/validate.js';
import { requireUser, userId } from '../middleware/auth.js';
import { IdParamSchema, TopicCreateSchema, type TopicCreate } from '../shared/index.js';
import { getGenerationQueue } from '../workers/queue.js';

export const topicsRouter = Router();

// requireUser is attached per route, not via topicsRouter.use(): this router is
// mounted at the root, so router-level middleware would also run for unmatched
// paths and turn every 404 into a 401.

/**
 * Creates the topic and hands generation off to the worker. 202, not 201: the
 * concept map doesn't exist yet, so the client polls GET /topics/:id until the
 * status leaves `generating` (T-018).
 */
topicsRouter.post('/topics', requireUser, validate(TopicCreateSchema), async (req, res) => {
  const body = req.body as TopicCreate;

  const [topic] = await db
    .insert(topics)
    .values({
      userId: userId(req),
      title: body.title,
      why: body.why ?? null,
      startsAt: body.startsAt ?? null,
      endsAt: body.endsAt ?? null,
      dailyBudgetMin: body.dailyBudgetMin,
    })
    .returning({ id: topics.id, status: topics.status });

  if (!topic) throw new Error('topic insert returned no row');

  // jobId = topicId so a duplicate enqueue for the same topic is a no-op rather
  // than generating (and paying for) the same map twice.
  await getGenerationQueue().add('generate', { topicId: topic.id }, { jobId: topic.id });

  res.status(202).json({ topicId: topic.id, status: topic.status });
});

topicsRouter.get('/topics', requireUser, async (req, res) => {
  const rows = await db
    .select({
      id: topics.id,
      title: topics.title,
      status: topics.status,
      createdAt: topics.createdAt,
    })
    .from(topics)
    .where(eq(topics.userId, userId(req)))
    .orderBy(desc(topics.createdAt));

  res.json({ topics: rows });
});

topicsRouter.get('/topics/:id', requireUser, validate(IdParamSchema, 'params'), async (req, res) => {
  const { id } = req.params as { id: string };

  // Scope by owner in the query itself: a topic belonging to someone else must
  // 404, not 403 — a 403 would confirm the id exists.
  const [topic] = await db
    .select()
    .from(topics)
    .where(and(eq(topics.id, id), eq(topics.userId, userId(req))));

  if (!topic) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  const [conceptCount] = await db
    .select({ n: count() })
    .from(concepts)
    .where(eq(concepts.topicId, id));

  const [itemCount] = await db
    .select({ n: count() })
    .from(items)
    .innerJoin(concepts, eq(items.conceptId, concepts.id))
    .where(eq(concepts.topicId, id));

  res.json({
    id: topic.id,
    title: topic.title,
    why: topic.why,
    status: topic.status,
    error: topic.error,
    startsAt: topic.startsAt,
    endsAt: topic.endsAt,
    dailyBudgetMin: topic.dailyBudgetMin,
    createdAt: topic.createdAt,
    counts: { concepts: conceptCount?.n ?? 0, items: itemCount?.n ?? 0 },
  });
});
