import { and, asc, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { cards, conceptPrereqs, concepts, topics } from '../../db/schema.js';

/** Scoped by owner inside the query — a 403 would confirm the topic exists. */
export async function findOwnedTopic(topicId: string, userId: string) {
  const [topic] = await db
    .select()
    .from(topics)
    .where(and(eq(topics.id, topicId), eq(topics.userId, userId)));
  return topic ?? null;
}

/** Every concept with the learner's card state, in teaching order. */
export async function findMapRows(userId: string, topicId: string) {
  return db
    .select({
      id: concepts.id,
      title: concepts.title,
      order: concepts.order,
      heldOut: concepts.heldOut,
      due: cards.due,
      stability: cards.stability,
      difficulty: cards.difficulty,
      elapsedDays: cards.elapsedDays,
      scheduledDays: cards.scheduledDays,
      reps: cards.reps,
      lapses: cards.lapses,
      state: cards.state,
      lastReview: cards.lastReview,
      taughtAt: cards.taughtAt,
    })
    .from(concepts)
    .leftJoin(cards, and(eq(cards.conceptId, concepts.id), eq(cards.userId, userId)))
    .where(eq(concepts.topicId, topicId))
    .orderBy(asc(concepts.order));
}

export async function findEdges(topicId: string) {
  return db
    .select({
      from: conceptPrereqs.prerequisiteConceptId,
      to: conceptPrereqs.conceptId,
    })
    .from(conceptPrereqs)
    .innerJoin(concepts, eq(conceptPrereqs.conceptId, concepts.id))
    .where(eq(concepts.topicId, topicId));
}
