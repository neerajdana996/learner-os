import { DueItemsResponseSchema, type MeResponse } from '@learnos/shared';
import { apiFetch, NotConnectedError } from '../lib/api';
import { recordShown, shouldShow, type PopDecision } from '../lib/schedule';
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

async function tick(): Promise<void> {
  // No token means the learner has not been through "Connect extension" yet.
  // Not an error, and not worth a log line every five minutes forever.
  if (!(await getToken())) return;

  const now = new Date();
  const me = await loadMe(now.getTime());
  if (!me) return;

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

  browser.notifications.onClicked.addListener(() => {
    void browser.notifications.clear(NOTIFICATION_ID);
    void browser.action.openPopup?.();
  });
});
