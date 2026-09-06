import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { dailyPulse } from '../../db/schema.js';
import type { PulseCreate } from '@learnos/shared';

/**
 * One row per user per day, upserted.
 *
 * The unique index on `(user_id, date)` is what makes this idempotent, and it
 * has to be: the client asks once a day but a retry, a double tap or a replay
 * from a flaky connection must not produce two moods for one day. A learner
 * changing their mind overwrites — the last tap of the day is the answer.
 */
export async function upsertPulse(userId: string, pulse: PulseCreate): Promise<void> {
  await db
    .insert(dailyPulse)
    .values({ userId, date: new Date(`${pulse.day}T00:00:00Z`), mood: pulse.mood })
    .onConflictDoUpdate({
      target: [dailyPulse.userId, dailyPulse.date],
      set: { mood: pulse.mood },
    });
}
