import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { browser } from 'wxt/browser';
import { clearToken, getToken, setToken, TOKEN_KEY } from '../storage';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('token storage', () => {
  it('round trips a token', async () => {
    await setToken('tok_abc123');
    expect(await getToken()).toBe('tok_abc123');
  });

  it('is null before anything is connected', async () => {
    expect(await getToken()).toBeNull();
  });

  it('trims a pasted token', async () => {
    // Copying out of a web page routinely brings a newline with it, and an
    // untrimmed token fails as a 401 that reads like a server fault.
    await setToken('  tok_abc123\n');

    expect(await getToken()).toBe('tok_abc123');
    expect((await browser.storage.local.get(TOKEN_KEY))[TOKEN_KEY]).toBe('tok_abc123');
  });

  it('refuses to store an empty token instead of storing a useless one', async () => {
    await expect(setToken('   ')).rejects.toThrow();
    expect(await getToken()).toBeNull();
  });

  it('treats an empty stored value as not connected', async () => {
    await browser.storage.local.set({ [TOKEN_KEY]: '' });
    expect(await getToken()).toBeNull();
  });

  it('clears the token', async () => {
    await setToken('tok_abc123');
    await clearToken();
    expect(await getToken()).toBeNull();
  });

  it('stores it in local, never in sync — sync would push a credential to every signed-in browser', async () => {
    await setToken('tok_abc123');
    expect(await browser.storage.sync.get(TOKEN_KEY)).toEqual({});
  });
});
