import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { topics } from '../db/schema.js';

/**
 * Is this topic still teaching?
 *
 * A course runs for seven days and then goes quiet until the day-30 test
 * (plan.md §2). The silence is not a UI nicety — it *is* the measurement. If
 * reviews keep arriving on days 8 to 29, the day-30 test is not a cold test,
 * and the one number the pilot exists to produce means nothing. Nothing else
 * in the system notices when `endsAt` passes: `status` stays `'active'`
 * forever, because nothing ever sets `'done'`.
 *
 * Two forms of the same rule, deliberately in one file. One is a SQL fragment
 * for queries that filter in the database, the other is for rows already
 * loaded. Keeping them apart is how they drift, and a drift here fails
 * silently — the app keeps working and the result quietly stops meaning
 * anything.
 *
 * A null `endsAt` is treated as still teaching: that is the bare Sprint 1 demo
 * topic, which has no deadline to be past.
 */

/** SQL: the topic is active and `now` is inside its teaching window. */
export function withinTeachingWindow(now: Date) {
  return and(eq(topics.status, 'active'), or(isNull(topics.endsAt), gt(topics.endsAt, now)));
}

/** The same rule for a row already in memory. */
export function isTeaching(
  topic: { status: string | null; endsAt: Date | null },
  now: Date,
): boolean {
  if (topic.status !== 'active') return false;
  return topic.endsAt === null || topic.endsAt.getTime() > now.getTime();
}
