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
