import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeBrowser } from 'wxt/testing';
import { browser } from 'wxt/browser';
import { Popup } from '../Popup';
import { setToken } from '../../../lib/storage';

const item = {
  itemId: '11111111-1111-4111-8111-111111111111',
  conceptId: '22222222-2222-4222-8222-222222222222',
  type: 'recall' as const,
  prompt: 'What is a replica in a distributed system?',
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  fakeBrowser.reset();
});

describe('Popup', () => {
  it('offers a way to connect when there is no token', async () => {
    const openOptionsPage = vi.fn();
    vi.spyOn(browser.runtime, 'openOptionsPage').mockImplementation(openOptionsPage);

    render(<Popup />);

    // Chrome's own extension menu is the only other route to the options page,
    // and nobody finds it.
    const button = await screen.findByRole('button', { name: 'Connect' });
    await userEvent.click(button);
    expect(openOptionsPage).toHaveBeenCalled();
  });

  it('does not ask a connected learner to connect again', async () => {
    await setToken('tok_abc123');

    render(<Popup />);

    expect(await screen.findByText(/Nothing due right now/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull();
  });
});

describe('opening the popup on purpose (T-129)', () => {
  it('asks the server for a card instead of waiting for the alarm', async () => {
    // The worker stores a card when it decides to *interrupt* you, on a
    // five-minute alarm. Rendering only what it happened to leave behind told a
    // learner who clicked the icon "nothing due right now" while /due had a
    // question waiting.
    await setToken('tok_abc123');
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [item] })));

    render(<Popup />);

    expect(await screen.findByText(item.prompt)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('still says nothing is due when the server has nothing', async () => {
    await setToken('tok_abc123');
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [] })));

    render(<Popup />);

    expect(await screen.findByText(/Nothing due right now/)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('says the same thing when the request fails, rather than an error code', async () => {
    // Offline, disconnected, or nothing due all read the same to the learner,
    // and a status code would not help anyone standing at a popup.
    await setToken('tok_abc123');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));

    render(<Popup />);

    expect(await screen.findByText(/Nothing due right now/)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('never asks when nobody is connected', async () => {
    // No token means the learner has not been through Connect yet; a request
    // would only produce a NotConnectedError to swallow.
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<Popup />);

    await screen.findByRole('button', { name: 'Connect' });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
