import { DueItemsResponseSchema, type MeResponse } from '@learnos/shared';
import { apiFetch, NotConnectedError, postReview, postTelemetry } from '../lib/api';
import { drain } from '../lib/queue';
import { recordDismissed, recordShown, shouldShow, type PopDecision } from '../lib/schedule';
import {
  clearCardOpen,
  isAbandoned,
  readBuffer,
  readCardOpen,
  record,
  TELEMETRY_KEY,
} from '../lib/telemetry';
import {
  getCachedMe,
  getPopState,
  getToken,
  setCachedMe,
  setPendingCard,
  setPopState,
} from '../lib/storage';

/**
 * The MV3 service worker: the half of the product that comes and finds you.
 *
 * It is killed between alarms and keeps nothing in memory, so every decision is
 * made from `chrome.storage.local` and the pure rule in `lib/schedule.ts`. The
 * worker's own job is only the parts that cannot be pure — the clock, idle
 * state, the network, and the notification.
 *
 * A worker cannot open its own popup. So a card that is due is *stored* and
 * announced with a notification; clicking it opens the popup, which renders
 * whatever is waiting (T-029).
 */

const ALARM = 'learnos.tick';
/** Five minutes is the floor Chrome enforces for a persistent alarm anyway. */
const TICK_MINUTES = 5;
const ME_MAX_AGE_MS = 60 * 60 * 1000;
const NOTIFICATION_ID = 'learnos.card';

/** Cached for an hour: `shouldShow` needs the timezone, the windows and the cap
 *  on every tick, and fetching them twelve times an hour to conclude "they are
 *  asleep" is pure noise on someone's network. */
async function loadMe(now: number): Promise<MeResponse | null> {
  const cached = await getCachedMe(now, ME_MAX_AGE_MS);
  if (cached) return cached;

  const response = await apiFetch('/me');
  if (!response.ok) return null;
  const me = (await response.json()) as MeResponse;
  await setCachedMe(me, now);
  return me;
}

/**
 * Empties the offline queue (T-031).
 *
 * Runs before the tick decides anything, and unconditionally: answers already
 * given are more valuable than a new card, and a learner who is capped, asleep
 * or backed off still has answers owed to the server.
 */
async function sync(): Promise<void> {
  if (!(await getToken())) return;
  const report = await drain(async (answer) => {
    await postReview(answer);
  });
  if (report.sent > 0 || report.dropped > 0) {
    console.info('learnos queue', report);
  }
}

/**
 * A card that was opened and never acted on (T-035).
 *
 * Chrome destroys an extension popup the moment it loses focus, so this cannot
 * be observed from the popup — there is no reliable unload in which to send
 * anything. The card leaves a marker when it mounts and clears it on any
 * action; a marker still here on a later alarm means the question was put in
 * front of someone and abandoned.
 *
 * It counts as a dismissal, because that is what it is: the task says so, and
 * the backoff exists to notice exactly this pattern. Someone who opens three
 * cards and walks away from all three is telling us the same thing as someone
 * who presses ✕ three times.
 */
async function sweepOpenCard(now: Date, timezone: string | null): Promise<void> {
  const open = await readCardOpen();
  if (!isAbandoned(open, now.getTime())) return;

  await record('card_closed_no_action', { itemId: open?.itemId ?? 'unknown' }, now.getTime());
  await clearCardOpen();
  await setPopState(recordDismissed(await getPopState(), now, timezone));
}

/** Sends whatever the popup buffered. Cleared only on success — a failed flush
 *  keeps the events for the next alarm, the same rule the answer queue uses. */
async function flushTelemetry(): Promise<void> {
  const buffered = await readBuffer();
  if (buffered.length === 0) return;

  const batch = buffered.slice(0, 50);
  await postTelemetry(batch);
  const rest = (await readBuffer()).slice(batch.length);
  await browser.storage.local.set({ [TELEMETRY_KEY]: rest });
}

async function tick(): Promise<void> {
  // No token means the learner has not been through "Connect extension" yet.
  // Not an error, and not worth a log line every five minutes forever.
  if (!(await getToken())) return;

  await sync();

  const now = new Date();
  const me = await loadMe(now.getTime());
  if (!me) return;

  // Before the decision, because an abandoned card is a dismissal and a
  // dismissal can be the third one — which is what stops the day.
  await sweepOpenCard(now, me.timezone);
  await flushTelemetry();

  // `idle` and `locked` are both "not at the keyboard". A card shown to an
  // empty chair spends the daily cap and teaches nothing.
  const idleState = await browser.idle.queryState(60);
  const state = await getPopState();

  const decision: PopDecision = shouldShow({
    state,
    now,
    me,
    idle: idleState !== 'active',
  });
  if (!decision.show) return;

  const response = await apiFetch('/due?limit=1');
  if (!response.ok) return;

  const due = DueItemsResponseSchema.safeParse(await response.json());
  // A parse failure means the server changed shape under us. Better to go quiet
  // than to hand the card UI something it cannot render.
  if (!due.success) return;

  const item = due.data.items[0];
  // Nothing due is the normal case during the quiet period, and after `endsAt`
  // it is the *only* case — the server stops serving a finished course (T-105).
  if (!item) return;

  await setPendingCard(item);
  // The denominator of the answer rate. Recorded at the notification, not at
  // the /due fetch: what was served and what was shown are different numbers,
  // and only this one is a card a human saw.
  await record('card_shown', { itemId: item.itemId }, now.getTime());
  // The counters move when the card is offered, not when it is answered:
  // otherwise an ignored notification would let the next tick offer another one
  // twenty minutes later, and another, until the cap was spent on a stack of
  // unread notifications.
  await setPopState(recordShown(state, now, me.timezone));

  await browser.notifications.create(NOTIFICATION_ID, {
    type: 'basic',
    iconUrl: browser.runtime.getURL('/icon/128.png'),
    title: 'One question',
    message: 'Twenty seconds. Click to answer.',
    // No buttons: the answer needs the card, and a notification that looks
    // answerable but is not is worse than one that plainly is not.
    requireInteraction: false,
  });
}

export default defineBackground(() => {
  browser.alarms.create(ALARM, { periodInMinutes: TICK_MINUTES });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM) return;
    // Nothing awaits this listener, so an unhandled rejection would be an
    // invisible dead worker. Every failure is swallowed deliberately: the next
    // tick is five minutes away and retrying is free.
    void tick().catch((error) => {
      if (error instanceof NotConnectedError) return;
      console.warn('learnos tick failed', error);
    });
  });

  // Best-effort, not the mechanism. An MV3 worker is killed between alarms, so
  // this only fires when the network returns while it happens to be awake —
  // which is worth having (it turns a five-minute wait into none) and worth
  // nothing to rely on. The alarm is what actually guarantees the drain.
  self.addEventListener('online', () => {
    void sync().catch((error) => {
      if (error instanceof NotConnectedError) return;
      console.warn('learnos sync failed', error);
    });
  });

  browser.notifications.onClicked.addListener(() => {
    void browser.notifications.clear(NOTIFICATION_ID);
    void browser.action.openPopup?.();
  });
});
