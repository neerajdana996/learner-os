/**
 * A simulated day, end to end (T-037).
 *
 * The unit tests each prove one rule. This proves the rules *compose* over a
 * day, against real `chrome.storage.local` (`fakeBrowser`) and a clock that
 * only moves forwards — which is where the interesting failures live. Two of
 * them would pass every unit test in the suite:
 *
 *  - a snooze must not break a run of dismissals, but must still delay the next
 *    card (it moves `lastShownAt`, not `consecutiveDismissals`);
 *  - a backoff set in the morning must still be in force in the *second*
 *    active window that evening, or "not today" silently means "not for the
 *    next twenty minutes".
 *
 * There is no network and no UI here. The popup's handlers (`Card.tsx`) and the
 * worker's tick (`background.ts`) are thin wrappers over these calls, so the
 * helpers below deliberately mirror them line for line; if one of those files
 * changes what it writes, this test is where it should start failing.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import type { Answer, MeResponse } from '@learnos/shared';
import {
  MIN_GAP_MS,
  recordAnswered,
  recordDismissed,
  recordShown,
  shouldShow,
  type PopDecision,
} from '../lib/schedule';
import { drain, enqueue, readQueue } from '../lib/queue';
import { getPopState, POP_STATE_KEY, setPopState } from '../lib/storage';
import { clearCardOpen, markCardOpen, readBuffer, readCardOpen, record } from '../lib/telemetry';

/** Card.tsx's own constant. Duplicated rather than exported: the test should
 *  fail if the popup changes what "later" means without anyone noticing. */
const SNOOZE_MS = 30 * 60 * 1000;

/**
 * Two windows, a morning and an evening, in UTC so every wall clock below is
 * readable. Two is the point: the evening one is what proves a backoff lasts
 * the day rather than the window.
 */
const me: MeResponse = {
  id: '00000000-0000-4000-8000-000000000000',
  email: 'learner@example.com',
  name: 'A learner',
  timezone: 'UTC',
  activeWindows: [
    { start: '09:00', end: '11:00' },
    { start: '20:00', end: '22:00' },
  ],
  profile: { dailyCap: 12, calibrationGap: null },
  hasExtensionToken: true,
};

const DAY_1 = '2026-09-14';
const DAY_2 = '2026-09-15';
/** `at('09:00')` — the same day unless a second argument says otherwise. */
const at = (hhmm: string, day = DAY_1) => new Date(`${day}T${hhmm}:00.000Z`);

let nextItem = 0;
const itemId = () => `11111111-1111-4111-8111-00000000000${nextItem++}`;
const answerFor = (id: string, over: Partial<Answer> = {}): Answer => ({
  itemId: id,
  response: 'advance left until the count hits zero',
  confidence: null,
  surface: 'extension',
  idempotencyKey: `22222222-2222-4222-8222-00000000000${nextItem}`,
  ...over,
});

// ---------------------------------------------------------------- the harness

/** One alarm tick's decision, and the two writes the worker makes when it pops
 *  a card. Mirrors `tick()` in `entrypoints/background.ts`. */
async function offer(now: Date): Promise<PopDecision & { itemId?: string }> {
  const state = await getPopState();
  const decision = shouldShow({ state, now, me, idle: false });
  if (!decision.show) return decision;

  const id = itemId();
  // Counted when the card is offered, not when it is answered: otherwise an
  // ignored notification lets the next tick offer another one.
  await record('card_shown', { itemId: id }, now.getTime());
  await setPopState(recordShown(state, now, me.timezone));
  await markCardOpen(id, now.getTime());
  return { ...decision, itemId: id };
}

/** `Card.submit()` — right, wrong or still queued, an answer breaks a run of
 *  refusals. `send` decides whether it reached the server. */
async function answer(
  id: string,
  now: Date,
  send: (a: Answer) => Promise<void>,
): Promise<void> {
  const payload = answerFor(id);
  try {
    await send(payload);
  } catch {
    // The popup enqueues on a network error or a 5xx and tells the learner it
    // is kept, which is the whole reason the queue exists.
    await enqueue(payload, now.getTime());
  }
  await clearCardOpen();
  await setPopState(recordAnswered(await getPopState()));
}

/** `Card.snooze()` — not a refusal. Pushes the stamp forward so the 20-minute
 *  gate expires 30 minutes from now, and leaves the dismissal run alone. */
async function snooze(now: Date): Promise<void> {
  await clearCardOpen();
  const state = await getPopState();
  await setPopState({ ...state, lastShownAt: now.getTime() + (SNOOZE_MS - MIN_GAP_MS) });
}

/** `Card.dismiss()`. */
async function dismiss(now: Date): Promise<void> {
  await clearCardOpen();
  await setPopState(recordDismissed(await getPopState(), now, me.timezone));
}

beforeEach(() => {
  fakeBrowser.reset();
  nextItem = 0;
});

// ------------------------------------------------------------------ the day

describe('a simulated day', () => {
  it('runs the whole day and ends backed off, synced and empty', async () => {
    /** Every answer given while this is false is kept rather than lost. */
    let online = false;
    const sent: Answer[] = [];
    const send = async (a: Answer) => {
      if (!online) throw new Error('network down');
      sent.push(a);
    };

    // 08:30 — awake, but this is nobody's idea of a good moment.
    expect(await offer(at('08:30'))).toEqual({ show: false, reason: 'outside_window' });

    // 09:00 — card 1. Answered wrong, and offline: the answer is kept.
    const first = await offer(at('09:00'));
    expect(first.show).toBe(true);
    await answer(first.itemId!, at('09:00'), send);
    expect(await readQueue()).toHaveLength(1);
    // An answer breaks the run whether or not it reached the server — backing
    // off because someone's wifi dropped would punish them for showing up.
    expect((await getPopState()).consecutiveDismissals).toBe(0);

    // 09:05 — a drain while still offline keeps everything and says why.
    const offlineDrain = await drain(send, at('09:05').getTime());
    expect(offlineDrain).toMatchObject({ sent: 0, remaining: 1, stoppedBy: 'offline' });

    // 09:10 — ten minutes is not twenty.
    expect(await offer(at('09:10'))).toEqual({ show: false, reason: 'too_soon' });

    // 09:25 — card 2, snoozed. Back online from here.
    online = true;
    const second = await offer(at('09:25'));
    expect(second.show).toBe(true);
    await snooze(at('09:25'));

    // 09:50 — the snooze holds: 25 minutes after the card, and still no.
    // A plain 20-minute gap would have let this through, so this asserts the
    // snooze did something rather than nothing.
    expect(await offer(at('09:50'))).toEqual({ show: false, reason: 'too_soon' });

    // 09:56 — card 3, dismissed. First refusal.
    const third = await offer(at('09:56'));
    expect(third.show).toBe(true);
    await dismiss(at('09:56'));
    expect((await getPopState()).consecutiveDismissals).toBe(1);

    // 10:20 — card 4, dismissed. Second refusal, and the snooze in between did
    // not reset the run.
    const fourth = await offer(at('10:20'));
    expect(fourth.show).toBe(true);
    await dismiss(at('10:20'));
    const afterTwo = await getPopState();
    expect(afterTwo.consecutiveDismissals).toBe(2);
    expect(afterTwo.backoffUntil).toBeNull();

    // 10:45 — one more. The third refusal stops the day.
    const fifth = await offer(at('10:45'));
    expect(fifth.show).toBe(true);
    await dismiss(at('10:45'));
    const backedOff = await getPopState();
    expect(backedOff.consecutiveDismissals).toBe(3);
    expect(backedOff.backoffUntil).not.toBeNull();
    // Until the learner's own midnight, not "+24h" — backing off until 10:45
    // tomorrow would silently eat a second day.
    expect(new Date(backedOff.backoffUntil!).toISOString()).toBe(at('00:00', DAY_2).toISOString());

    // 10:50 — inside the window, under the cap, and still nothing.
    expect(await offer(at('10:50'))).toEqual({ show: false, reason: 'backoff' });

    // 20:30 — the evening window opens and the answer is still no. This is the
    // assertion the unit tests cannot make: a day means a day.
    expect(await offer(at('20:30'))).toEqual({ show: false, reason: 'backoff' });

    // 20:35 — the queue drains now that the network is back, and the answer is
    // sent with the time it was *given*, not the time it synced.
    const report = await drain(send, at('20:35').getTime());
    expect(report).toMatchObject({ sent: 1, dropped: 0, remaining: 0, stoppedBy: null });
    expect(await readQueue()).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.answeredAt).toBe(at('09:00').toISOString());

    // ------------------------------------------------------- final storage
    const end = await getPopState();
    expect(end).toMatchObject({
      day: DAY_1,
      dailyCount: 5,
      consecutiveDismissals: 3,
    });
    // Five cards offered, five events, and nothing else buffered.
    const buffered = await readBuffer();
    expect(buffered).toHaveLength(5);
    expect(new Set(buffered.map((e) => e.event))).toEqual(new Set(['card_shown']));
    // Every card was acted on, so nothing is left looking abandoned.
    expect(await readCardOpen()).toBeNull();
  });

  it('lets the next day through, and does not forgive the backoff early', async () => {
    await setPopState({
      day: DAY_1,
      dailyCount: 5,
      lastShownAt: at('10:45').getTime(),
      consecutiveDismissals: 3,
      backoffUntil: at('00:00', DAY_2).getTime(),
    });

    // 23:30 on day 1 — the backoff has not expired yet.
    expect(await offer(at('23:30'))).toEqual({ show: false, reason: 'backoff' });

    // 09:00 the next morning — a new local day, and the counters roll over.
    const fresh = await offer(at('09:00', DAY_2));
    expect(fresh.show).toBe(true);
    expect(await getPopState()).toMatchObject({
      day: DAY_2,
      dailyCount: 1,
      consecutiveDismissals: 0,
    });
  });

  it('spends nothing on an empty chair', async () => {
    // Idle beats every other reason, and is checked first: a card shown to
    // someone who is not there burns the daily cap and teaches nothing.
    const state = await getPopState();
    expect(shouldShow({ state, now: at('09:00'), me, idle: true })).toEqual({
      show: false,
      reason: 'idle',
    });
    expect(await readBuffer()).toEqual([]);
  });

  it('stops for the day at the cap, whatever the learner does', async () => {
    await setPopState({
      day: DAY_1,
      dailyCount: 12,
      lastShownAt: at('09:00').getTime(),
      consecutiveDismissals: 0,
      backoffUntil: null,
    });
    // Well past the gap, inside the window, not backed off, answering
    // everything correctly — and still done until tomorrow.
    expect(await offer(at('10:30'))).toEqual({ show: false, reason: 'cap_reached' });
    expect(await fakeBrowser.storage.local.get(POP_STATE_KEY)).toMatchObject({
      [POP_STATE_KEY]: { dailyCount: 12 },
    });
  });
});
