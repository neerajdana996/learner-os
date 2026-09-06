import { db } from '../../db/client.js';
import { clientEvents } from '../../db/schema.js';
import type { Telemetry } from '@learnos/shared';

export async function insertEvents(userId: string, events: Telemetry['events'], now: Date) {
  const rows = events.map((e) => ({
    userId,
    event: e.event,
    meta: e.meta ?? null,
    // A device clock can be wrong and a queued event can be old; neither is
    // worth rejecting a whole batch over, so an unusable stamp becomes now.
    at: stampOf(e.at, now),
  }));
  await db.insert(clientEvents).values(rows);
  return rows.length;
}

function stampOf(at: string | undefined, now: Date): Date {
  if (!at) return now;
  const parsed = Date.parse(at);
  if (Number.isNaN(parsed)) return now;
  // Never in the future: a wrong device clock would otherwise put events beyond
  // the end of any window a metric asks for, and they would silently vanish
  // from the counts they exist to feed.
  return new Date(Math.min(parsed, now.getTime()));
}
