import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { sessionDays } from '../../db/schema.js';

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
