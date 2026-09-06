/**
 * What the extension reports about itself (T-035).
 *
 * **Buffered in storage, flushed by the worker — never sent from the popup.**
 * Chrome destroys an extension popup the instant it loses focus, and an
 * in-flight `fetch` dies with it. The single most important event here is
 * exactly the one that fires as the popup is being destroyed
 * (`card_closed_no_action`), so posting directly would lose precisely the
 * measurement this exists to take. Writing to `chrome.storage.local` is fast
 * enough to win that race; the five-minute alarm does the sending.
 *
 * `card_closed_no_action` is not recorded on close at all, for the same reason
 * — it is inferred by the worker from a marker the card leaves behind. See
 * `sweepOpenCard`.
 */
import { browser } from 'wxt/browser';
import type { ClientEvent, ClientEventName } from '@learnos/shared';

export const TELEMETRY_KEY = 'learnos.telemetry';
export const OPEN_CARD_KEY = 'learnos.openCard';

/** One flush is 50 events (the wire cap). Beyond this the oldest go: a backlog
 *  this size means the worker has not run for hours, and recent behaviour is
 *  what the answer rate is measured over. */
export const MAX_BUFFERED = 200;

/**
 * A card is open and unanswered.
 *
 * Written when the card mounts and cleared the moment anything happens to it.
 * If it is still here on the next alarm, the popup was closed without an
 * answer — which is the event, and the only way to observe it.
 */
export interface OpenCard {
  itemId: string;
  openedAt: number;
}

export async function record(
  event: ClientEventName,
  meta?: ClientEvent['meta'],
  now = Date.now(),
): Promise<void> {
  const buffered = await readBuffer();
  const next = [...buffered, { event, meta, at: new Date(now).toISOString() }];
  await browser.storage.local.set({
    [TELEMETRY_KEY]: next.length > MAX_BUFFERED ? next.slice(next.length - MAX_BUFFERED) : next,
  });
}

export async function readBuffer(): Promise<ClientEvent[]> {
  const stored = await browser.storage.local.get(TELEMETRY_KEY);
  const value = stored[TELEMETRY_KEY];
  return Array.isArray(value) ? (value as ClientEvent[]) : [];
}

export async function markCardOpen(itemId: string, now = Date.now()): Promise<void> {
  await browser.storage.local.set({ [OPEN_CARD_KEY]: { itemId, openedAt: now } satisfies OpenCard });
}

/** Called the moment the card is answered, snoozed or dismissed — all three are
 *  actions, and only the absence of one is what this measures. */
export async function clearCardOpen(): Promise<void> {
  await browser.storage.local.remove(OPEN_CARD_KEY);
}

export async function readCardOpen(): Promise<OpenCard | null> {
  const stored = await browser.storage.local.get(OPEN_CARD_KEY);
  const value = stored[OPEN_CARD_KEY];
  return value && typeof value === 'object' ? (value as OpenCard) : null;
}

/**
 * How long a card may sit open before the worker calls it abandoned.
 *
 * Longer than anyone spends on a twenty-second question, because the cost of
 * being wrong is asymmetric: calling a still-open card abandoned records a
 * non-answer for someone who is mid-thought *and* counts a dismissal against
 * them, and three of those stop the extension for the day.
 */
export const ABANDONED_AFTER_MS = 5 * 60 * 1000;

export function isAbandoned(open: OpenCard | null, now: number): boolean {
  return open !== null && now - open.openedAt >= ABANDONED_AFTER_MS;
}
