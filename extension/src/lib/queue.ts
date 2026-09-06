/**
 * The answers that could not be sent (T-031).
 *
 * A pilot is a measurement, and the extension is the surface most likely to be
 * offline: a laptop lid closing mid-answer, a train, a cafe wifi that resolves
 * DNS but routes nothing. Before this, `Card.tsx` caught the failure and told
 * the learner their answer was lost — honest, but the answer was still lost,
 * and a lost answer is a missing point on the retention curve that no later
 * session can reconstruct.
 *
 * The queue is only safe because `idempotencyKey` is minted once per card
 * (T-029) and `recordReview` looks it up before doing anything (T-009). A
 * replay is therefore a read, not a second event — which is what lets this
 * retry at all rather than risking a double-scheduled card.
 *
 * Pure decisions live in `drainStep`; `chrome.storage.local` and `fetch` stay
 * at the edges, so the retry rules are testable without a fake network.
 */
import { browser } from 'wxt/browser';
import type { Answer } from '@learnos/shared';

export const QUEUE_KEY = 'learnos.queue';

/**
 * Three attempts, then the answer is dropped.
 *
 * Dropping real data is unpleasant, and it is still better than a queue that
 * retries one poisoned payload every five minutes until the pilot ends —
 * because that queue is also FIFO, and the item at the head blocks every good
 * answer behind it.
 */
export const MAX_ATTEMPTS = 3;

/** Waited before attempt 2 and attempt 3. The alarm ticks every five minutes,
 *  so anything finer than this is decoration. */
export const BACKOFF_MS = [60_000, 5 * 60_000];

/**
 * Older than this and the answer is dropped unsent.
 *
 * The server clamps a backdated `answeredAt` to the same window
 * (`MAX_BACKDATE_MS`), so sending an older one would record it at a time it did
 * not happen. A wrong data point is worse than a missing one: missing is
 * visible in the counts, wrong is not.
 */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Roughly a month of a capped day, which no real outage reaches. Past it the
 *  oldest go first: they are closest to expiring unsendable anyway. */
export const MAX_QUEUED = 100;

export interface QueuedAnswer {
  answer: Answer;
  /** When the learner answered — becomes `answeredAt` on the wire. */
  queuedAt: number;
  attempts: number;
  /** Epoch ms; 0 means "ready now". */
  nextAttemptAt: number;
}

export async function readQueue(): Promise<QueuedAnswer[]> {
  const stored = await browser.storage.local.get(QUEUE_KEY);
  const value = stored[QUEUE_KEY];
  // A corrupt queue is discarded rather than thrown: it must never be able to
  // stop the extension from asking questions.
  return Array.isArray(value) ? (value as QueuedAnswer[]) : [];
}

export async function writeQueue(queue: QueuedAnswer[]): Promise<void> {
  await browser.storage.local.set({ [QUEUE_KEY]: queue });
}

/** Drops what can no longer be sent honestly, then caps the length. Pure. */
export function prune(queue: QueuedAnswer[], now: number): QueuedAnswer[] {
  const fresh = queue.filter((entry) => now - entry.queuedAt <= MAX_AGE_MS);
  return fresh.length > MAX_QUEUED ? fresh.slice(fresh.length - MAX_QUEUED) : fresh;
}

export async function enqueue(answer: Answer, now = Date.now()): Promise<void> {
  const queue = prune(await readQueue(), now);
  await writeQueue([...queue, { answer, queuedAt: now, attempts: 0, nextAttemptAt: 0 }]);
}

/** What the drain loop does about one outcome. */
export type StepOutcome =
  | { action: 'drop'; why: 'sent' | 'rejected' | 'exhausted' }
  | { action: 'retry'; entry: QueuedAnswer }
  | { action: 'stop'; why: 'not_ready' | 'offline' | 'unauthorized' };

/**
 * The retry rules, as a pure function of one entry and one outcome.
 *
 * - **2xx** — sent. Drop it.
 * - **4xx** — the server refuses this payload and will refuse it again in five
 *   minutes. Drop it, having logged, rather than blocking the queue behind it.
 * - **401** — the token is dead, and `apiFetch` has already cleared it. Stop,
 *   but **keep everything**: reconnecting should still deliver these answers,
 *   and dropping them would punish the learner for an expired credential.
 * - **5xx or a network error** — stop the whole drain. The next item is going
 *   to the same server over the same connection, so trying it is just noise.
 */
export function drainStep(
  entry: QueuedAnswer,
  outcome: { ok: true } | { ok: false; status: number | null },
  now: number,
): StepOutcome {
  if (entry.nextAttemptAt > now) return { action: 'stop', why: 'not_ready' };
  if (outcome.ok) return { action: 'drop', why: 'sent' };
  if (outcome.status === 401) return { action: 'stop', why: 'unauthorized' };
  if (outcome.status !== null && outcome.status >= 400 && outcome.status < 500) {
    return { action: 'drop', why: 'rejected' };
  }

  const attempts = entry.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) return { action: 'drop', why: 'exhausted' };
  return {
    action: 'retry',
    entry: {
      ...entry,
      attempts,
      nextAttemptAt: now + (BACKOFF_MS[attempts - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1] ?? 0),
    },
  };
}

export interface DrainReport {
  sent: number;
  dropped: number;
  remaining: number;
  stoppedBy: 'not_ready' | 'offline' | 'unauthorized' | null;
}

/**
 * Sends what it can, in the order it was answered.
 *
 * FIFO and head-blocking on purpose: an entry that is not yet due for its retry
 * stops the pass rather than being skipped, so a working queue drains in the
 * order things happened and the backoff means what it says. Everything that
 * fails permanently is dropped instead of retried, so the head cannot jam.
 *
 * `answeredAt` is stamped from `queuedAt` at send time — the server records the
 * answer at the moment it was given rather than the moment it synced, and
 * clamps the claim to the same seven-day window this queue prunes to.
 */
export async function drain(
  send: (answer: Answer) => Promise<void>,
  now = Date.now(),
): Promise<DrainReport> {
  let queue = prune(await readQueue(), now);
  const report: DrainReport = { sent: 0, dropped: 0, remaining: queue.length, stoppedBy: null };

  while (queue.length > 0) {
    const [entry, ...rest] = queue as [QueuedAnswer, ...QueuedAnswer[]];

    let outcome: { ok: true } | { ok: false; status: number | null };
    if (entry.nextAttemptAt > now) {
      // Not due yet. Nothing is sent, and `drainStep` is still asked so the
      // rule lives in exactly one place.
      outcome = { ok: false, status: null };
    } else {
      try {
        await send({ ...entry.answer, answeredAt: new Date(entry.queuedAt).toISOString() });
        outcome = { ok: true };
      } catch (error) {
        const status = (error as { status?: unknown }).status;
        outcome = { ok: false, status: typeof status === 'number' ? status : null };
      }
    }

    const step = drainStep(entry, outcome, now);
    if (step.action === 'drop') {
      if (step.why === 'sent') report.sent += 1;
      else {
        report.dropped += 1;
        console.warn('learnos: dropping a queued answer', step.why, entry.answer.itemId);
      }
      queue = rest;
      continue;
    }
    if (step.action === 'retry') {
      queue = [step.entry, ...rest];
      report.stoppedBy = 'offline';
      break;
    }
    report.stoppedBy = step.why;
    break;
  }

  report.remaining = queue.length;
  await writeQueue(queue);
  return report;
}
