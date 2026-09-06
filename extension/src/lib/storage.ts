/**
 * Everything the extension keeps on the device (T-027).
 *
 * `chrome.storage.local`, not `sync`: the extension token is a credential, and
 * `sync` would push it to every browser signed into the same Google account —
 * a login the learner never asked to spread. It is also the only store an MV3
 * service worker can rely on, since the worker is killed between alarms and
 * keeps nothing in memory.
 */
import { browser } from 'wxt/browser';
import { MeResponseSchema, type MeResponse } from '@learnos/shared';
import { EMPTY_STATE, type PopState } from './schedule';

/** One namespace so a later key (T-028's counters, T-031's queue) can't collide
 *  with a WXT internal or another extension's leftovers. */
export const TOKEN_KEY = 'learnos.token';

/** A stored token is a bearer credential for a real account, so reading it is
 *  deliberately explicit rather than a general `get(key)` helper. */
export async function getToken(): Promise<string | null> {
  const stored = await browser.storage.local.get(TOKEN_KEY);
  const token = stored[TOKEN_KEY];
  return typeof token === 'string' && token !== '' ? token : null;
}

/**
 * Trims before storing. The token reaches this function through a copy-paste
 * out of a web page, which routinely carries a trailing newline or a leading
 * space — and a token with whitespace fails as a silent 401 that looks like a
 * server problem rather than a paste problem.
 */
export async function setToken(token: string): Promise<void> {
  const trimmed = token.trim();
  if (trimmed === '') throw new Error('setToken: refusing to store an empty token');
  await browser.storage.local.set({ [TOKEN_KEY]: trimmed });
}

export async function clearToken(): Promise<void> {
  await browser.storage.local.remove(TOKEN_KEY);
}

/** The "when to pop" counters (T-028). Reset per user-local day by
 *  `rollOver()`; the worker is killed between alarms, so this is the only
 *  memory it has. */
export const POP_STATE_KEY = 'learnos.popState';

/** `/me` cached for an hour (T-028): `shouldShow()` needs the timezone, the
 *  windows and the cap on every five-minute alarm, and fetching all three
 *  twelve times an hour to answer "no, they are asleep" is pure noise. */
export const ME_CACHE_KEY = 'learnos.me';

/** The card the worker picked, waiting for the popup to render it (T-029). An
 *  MV3 worker cannot open a popup directly, so it stores the item and posts a
 *  notification; opening the popup reads this. */
export const PENDING_CARD_KEY = 'learnos.pendingCard';

export async function getPopState(): Promise<PopState> {
  const stored = await browser.storage.local.get(POP_STATE_KEY);
  const value = stored[POP_STATE_KEY];
  // Anything unparseable is treated as a fresh state rather than thrown: a
  // corrupt counter must not stop the extension asking questions forever.
  return value && typeof value === 'object' ? { ...EMPTY_STATE, ...(value as PopState) } : EMPTY_STATE;
}

export async function setPopState(state: PopState): Promise<void> {
  await browser.storage.local.set({ [POP_STATE_KEY]: state });
}

interface CachedMe {
  fetchedAt: number;
  me: MeResponse;
}

export async function getCachedMe(now: number, maxAgeMs: number): Promise<MeResponse | null> {
  const stored = await browser.storage.local.get(ME_CACHE_KEY);
  const cached = stored[ME_CACHE_KEY] as CachedMe | undefined;
  if (!cached || now - cached.fetchedAt > maxAgeMs) return null;
  const parsed = MeResponseSchema.safeParse(cached.me);
  return parsed.success ? parsed.data : null;
}

export async function setCachedMe(me: MeResponse, now: number): Promise<void> {
  await browser.storage.local.set({ [ME_CACHE_KEY]: { fetchedAt: now, me } satisfies CachedMe });
}

export async function setPendingCard(item: unknown): Promise<void> {
  await browser.storage.local.set({ [PENDING_CARD_KEY]: item });
}

export async function takePendingCard(): Promise<unknown | null> {
  const stored = await browser.storage.local.get(PENDING_CARD_KEY);
  const item = stored[PENDING_CARD_KEY] ?? null;
  // Taken, not read: a card must be answered once. Leaving it would let a
  // reopened popup re-ask a question already sent to /reviews.
  if (item !== null) await browser.storage.local.remove(PENDING_CARD_KEY);
  return item;
}
