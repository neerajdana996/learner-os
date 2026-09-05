import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { cards, conceptPrereqs, concepts, items, sessionDays, topics } from '../../db/schema.js';

export async function findActiveTopic(userId: string, topicId?: string) {
  const [topic] = await db
    .select()
    .from(topics)
    .where(
      topicId
        ? and(eq(topics.id, topicId), eq(topics.userId, userId))
        : and(eq(topics.userId, userId), eq(topics.status, 'active')),
    )
    .orderBy(asc(topics.createdAt))
    .limit(1);
  return topic ?? null;
}

/**
 * Every concept in the topic with the learner's card state attached, in
 * teaching order. One query rather than per-concept lookups — the planner needs
 * the whole picture to work out what is ready.
 */
export async function findConceptsWithCards(userId: string, topicId: string) {
  return db
    .select({
      id: concepts.id,
      title: concepts.title,
      order: concepts.order,
      heldOut: concepts.heldOut,
      teachMode: concepts.teachMode,
      tryFirstPrompt: concepts.tryFirstPrompt,
      explanationShort: concepts.explanationShort,
      explanationLong: concepts.explanationLong,
      corrections: concepts.corrections,
      taughtAt: cards.taughtAt,
    })
    .from(concepts)
    .leftJoin(cards, and(eq(cards.conceptId, concepts.id), eq(cards.userId, userId)))
    .where(eq(concepts.topicId, topicId))
    .orderBy(asc(concepts.order));
}

export async function findPrereqEdges(topicId: string) {
  return db
    .select({
      conceptId: conceptPrereqs.conceptId,
      prerequisiteConceptId: conceptPrereqs.prerequisiteConceptId,
    })
    .from(conceptPrereqs)
    .innerJoin(concepts, eq(conceptPrereqs.conceptId, concepts.id))
    .where(eq(concepts.topicId, topicId));
}

/** One item per concept, for the immediate retrieval check after teaching. */
export async function findItemsForConcepts(conceptIds: string[]) {
  if (conceptIds.length === 0) return [];
  return db
    .select({ id: items.id, conceptId: items.conceptId, payload: items.payload })
    .from(items)
    .where(inArray(items.conceptId, conceptIds));
}

/**
 * Marks concepts taught and schedules them. `taughtAt` is what lets the
 * extension start asking about them (plan.md §6), and `due` is now so the first
 * review can land later the same day.
 */
export async function teachConcepts(
  userId: string,
  rows: { conceptId: string; due: Date; taughtAt: Date }[],
) {
  if (rows.length === 0) return;
  await db
    .insert(cards)
    .values(rows.map((row) => ({ userId, ...row })))
    .onConflictDoUpdate({
      target: [cards.userId, cards.conceptId],
      // Only fills a blank: re-completing a session must not reset the FSRS
      // schedule of a concept already being reviewed.
      set: { taughtAt: sql`coalesce(${cards.taughtAt}, excluded.taught_at)` },
    });
}

export async function countUntaughtCards(userId: string, topicId: string) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(concepts)
    .leftJoin(cards, and(eq(cards.conceptId, concepts.id), eq(cards.userId, userId)))
    .where(and(eq(concepts.topicId, topicId), eq(concepts.heldOut, false), isNull(cards.taughtAt)));
  return row?.count ?? 0;
}

/**
 * Records that the learner finished today's session (T-023).
 *
 * Idempotent by way of the unique index on (user_id, topic_id, day) rather than
 * a read-then-write: two taps on "finish" race, and a check-then-insert would
 * let both through and 500 on the second.
 */
export async function markSessionComplete(userId: string, topicId: string, day: string): Promise<void> {
  await db.insert(sessionDays).values({ userId, topicId, day }).onConflictDoNothing();
}

export async function isSessionComplete(userId: string, topicId: string, day: string): Promise<boolean> {
  const [row] = await db
    .select({ id: sessionDays.id })
    .from(sessionDays)
    .where(
      and(eq(sessionDays.userId, userId), eq(sessionDays.topicId, topicId), eq(sessionDays.day, day)),
    );
  return row !== undefined;
}
