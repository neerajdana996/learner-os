/**
 * Clearing a learner's work, in foreign-key order (T-079).
 *
 * One implementation, two callers: `pnpm seed` wipes the dev user before
 * rebuilding their dataset, and `POST /dev/reset` does it on demand from the
 * app. Two hand-rolled delete sequences would drift the day a table gains a
 * foreign key — which is exactly how the seed came to fail on any database
 * anyone had actually used (T-078).
 *
 * The order below is the whole point: `review_events` references the item it
 * was an answer to and the card it scheduled, `session_days` and `tests`
 * reference the topic, and `concept_prereqs` references concepts on both
 * sides.
 */
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  cards,
  conceptPrereqs,
  concepts,
  items,
  reviewEvents,
  sessionDays,
  tests,
  topics,
} from '../db/schema.js';

export interface ResetSummary {
  topics: { title: string; concepts: number }[];
  reviewEvents: number;
  cards: number;
}

/**
 * `progress` keeps the topic and its generated content — concepts, items,
 * teaching prose — and throws away everything the learner did: answers, card
 * schedules, completed days, and the diagnostic walk. You land back at the
 * start of the course without paying to generate it again, which is the case
 * you want ninety percent of the time.
 *
 * `topics` additionally deletes the course itself, putting you back at
 * onboarding. That one costs a real generation to undo.
 */
export type ResetScope = 'progress' | 'topics';

export async function resetUser(userId: string, scope: ResetScope): Promise<ResetSummary> {
  const owned = await db
    .select({ id: topics.id, title: topics.title })
    .from(topics)
    .where(eq(topics.userId, userId));

  const summary: ResetSummary = { topics: [], reviewEvents: 0, cards: 0 };

  for (const topic of owned) {
    const conceptIds = (
      await db.select({ id: concepts.id }).from(concepts).where(eq(concepts.topicId, topic.id))
    ).map((row) => row.id);

    summary.topics.push({ title: topic.title, concepts: conceptIds.length });

    if (conceptIds.length > 0) {
      // Not scoped to the user: an item belongs to the topic, so another
      // account's stray event would block the delete just the same.
      const events = await db
        .delete(reviewEvents)
        .where(inArray(reviewEvents.conceptId, conceptIds))
        .returning({ id: reviewEvents.id });
      const removedCards = await db
        .delete(cards)
        .where(inArray(cards.conceptId, conceptIds))
        .returning({ id: cards.id });
      summary.reviewEvents += events.length;
      summary.cards += removedCards.length;
    }

    await db.delete(sessionDays).where(eq(sessionDays.topicId, topic.id));
    await db.delete(tests).where(eq(tests.topicId, topic.id));

    if (scope === 'topics') {
      if (conceptIds.length > 0) {
        await db.delete(items).where(inArray(items.conceptId, conceptIds));
        await db.delete(conceptPrereqs).where(inArray(conceptPrereqs.conceptId, conceptIds));
      }
      await db.delete(concepts).where(eq(concepts.topicId, topic.id));
      await db.delete(topics).where(eq(topics.id, topic.id));
    } else {
      // The diagnostic's walk is progress too: leaving it behind would make the
      // next run skip straight to the end and seed cards from stale estimates.
      await db.update(topics).set({ diagnosticState: null }).where(eq(topics.id, topic.id));
    }
  }

  return summary;
}
