import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { z } from 'zod';
import { ApiError, API_URL, apiFetch, apiJson, getMe, NotConnectedError } from '../api';
import { getToken, setToken } from '../storage';

const ME = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'learner@example.com',
  name: 'Pilot One',
  timezone: 'Asia/Kolkata',
  activeWindows: [{ start: '09:00', end: '12:00' }],
  profile: { dailyCap: 12, calibrationGap: null },
  hasExtensionToken: true,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fakeBrowser.reset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  it('attaches the stored token as a bearer header', async () => {
    await setToken('tok_abc123');
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await apiFetch('/me');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_URL}/me`);
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok_abc123');
  });

  it('never sends cookies — the service worker is a cross-origin caller', async () => {
    await setToken('tok_abc123');
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await apiFetch('/due?limit=1');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe('omit');
  });

  it('prefers an explicitly passed token over the stored one', async () => {
    await setToken('tok_stored');
    fetchMock.mockResolvedValue(jsonResponse(ME));

    await apiFetch('/me', { token: '  tok_pasted \n' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok_pasted');
  });

  it('throws NotConnectedError rather than calling the API with no credential', async () => {
    await expect(apiFetch('/me')).rejects.toBeInstanceOf(NotConnectedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sets a JSON content type only when there is a body', async () => {
    await setToken('tok_abc123');
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await apiFetch('/reviews', { method: 'POST', body: JSON.stringify({ itemId: 'x' }) });
    const [, post] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(post.headers).get('Content-Type')).toBe('application/json');

    await apiFetch('/me');
    const [, get] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(new Headers(get.headers).get('Content-Type')).toBeNull();
  });

  it('clears a stored token that comes back 401 — it is revoked, not retryable', async () => {
    await setToken('tok_dead');
    fetchMock.mockResolvedValue(new Response('unauthorized', { status: 401 }));

    await expect(apiFetch('/me')).rejects.toBeInstanceOf(ApiError);
    expect(await getToken()).toBeNull();
  });

  it('does not disconnect a working install when a *pasted* token is rejected', async () => {
    await setToken('tok_good');
    fetchMock.mockResolvedValue(new Response('unauthorized', { status: 401 }));

    await expect(apiFetch('/me', { token: 'tok_typo' })).rejects.toBeInstanceOf(ApiError);
    expect(await getToken()).toBe('tok_good');
  });

  it('surfaces the status on any other error', async () => {
    await setToken('tok_abc123');
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));

    await expect(apiFetch('/me')).rejects.toMatchObject({ status: 500 });
    // A 500 is transient; the token is still good.
    expect(await getToken()).toBe('tok_abc123');
  });
});

describe('apiJson', () => {
  it('parses the response with the given schema', async () => {
    await setToken('tok_abc123');
    fetchMock.mockResolvedValue(jsonResponse({ n: 2 }));

    expect(await apiJson(z.object({ n: z.number() }), '/thing')).toEqual({ n: 2 });
  });

  it('fails loudly when the server sends a shape we do not expect', async () => {
    await setToken('tok_abc123');
    fetchMock.mockResolvedValue(jsonResponse({ n: 'two' }));

    // Better here than as `undefined` reaching the card UI three calls later.
    await expect(apiJson(z.object({ n: z.number() }), '/thing')).rejects.toThrow();
  });
});

describe('getMe', () => {
  it('validates against the synced MeResponseSchema', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ME));

    const me = await getMe('tok_pasted');

    expect(me.email).toBe('learner@example.com');
    // The fields T-028's scheduler will read.
    expect(me.timezone).toBe('Asia/Kolkata');
    expect(me.activeWindows).toEqual([{ start: '09:00', end: '12:00' }]);
    expect(me.profile.dailyCap).toBe(12);
  });
});
