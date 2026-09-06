import type { Telemetry } from '@learnos/shared';
import { insertEvents } from './telemetry.repository.js';

/**
 * What the client says about itself (T-035).
 *
 * Two facts the server cannot observe on its own:
 *
 * - **`card_shown`** is the denominator of the answer rate. `/due` records what
 *   was *served*; only the extension knows what was actually put in front of
 *   someone, because a card is fetched, stored and then announced.
 * - **`card_closed_no_action`** is the largest category of non-answer and was
 *   completely invisible. Chrome destroys an extension popup the moment it
 *   loses focus — clicking back into the page is enough — so a card can be
 *   read, considered and abandoned without a single request.
 *
 * Accepted in batches and never rejected for one bad member: this is telemetry,
 * and losing a metric because one row had a stale timestamp is a worse outcome
 * than a slightly imprecise one.
 */
export async function recordEvents(
  userId: string,
  body: Telemetry,
  now: Date = new Date(),
): Promise<{ stored: number }> {
  return { stored: await insertEvents(userId, body.events, now) };
}
