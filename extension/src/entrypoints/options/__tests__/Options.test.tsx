import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeBrowser } from 'wxt/testing';
import { Options } from '../Options';
import { getToken, setToken } from '../../../lib/storage';

const ME = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'learner@example.com',
  name: 'Pilot One',
  timezone: 'Asia/Kolkata',
  activeWindows: [],
  profile: { dailyCap: 12, calibrationGap: null },
  hasExtensionToken: true,
};

const fetchMock = vi.fn();

beforeEach(() => {
  fakeBrowser.reset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Options — connect flow', () => {
  it('verifies a pasted token before storing it', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(ME), { status: 200 }));
    render(<Options />);

    await userEvent.type(await screen.findByLabelText('Extension token'), 'tok_good');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(await screen.findByText('learner@example.com')).toBeInTheDocument();
    expect(await getToken()).toBe('tok_good');
  });

  it('does not store a token the server rejects', async () => {
    fetchMock.mockResolvedValue(new Response('unauthorized', { status: 401 }));
    render(<Options />);

    await userEvent.type(await screen.findByLabelText('Extension token'), 'tok_typo');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));

    // Storing first and finding out on the next alarm would present as an
    // extension that silently does nothing — the hardest failure to report.
    expect(await screen.findByText(/was not accepted/)).toBeInTheDocument();
    expect(await getToken()).toBeNull();
  });

  it('says the backend is unreachable rather than blaming the token', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<Options />);

    await userEvent.type(await screen.findByLabelText('Extension token'), 'tok_good');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(await screen.findByText(/Could not reach/)).toBeInTheDocument();
  });

  it('reports a stored token that has since been revoked as disconnected', async () => {
    await setToken('tok_revoked');
    fetchMock.mockResolvedValue(new Response('unauthorized', { status: 401 }));

    render(<Options />);

    expect(await screen.findByText(/was not accepted/)).toBeInTheDocument();
    // apiFetch clears a stored token that 401s — it is revoked, not retryable.
    expect(await getToken()).toBeNull();
  });

  it('shows the connected account on open, without asking for a token again', async () => {
    await setToken('tok_good');
    fetchMock.mockResolvedValue(new Response(JSON.stringify(ME), { status: 200 }));

    render(<Options />);

    expect(await screen.findByText('learner@example.com')).toBeInTheDocument();
    expect(screen.queryByLabelText('Extension token')).toBeNull();
  });

  it('disconnects on request', async () => {
    await setToken('tok_good');
    fetchMock.mockResolvedValue(new Response(JSON.stringify(ME), { status: 200 }));
    render(<Options />);

    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));

    expect(await getToken()).toBeNull();
    expect(await screen.findByLabelText('Extension token')).toBeInTheDocument();
  });

  it('does not call the API with an empty token', async () => {
    render(<Options />);

    expect(await screen.findByRole('button', { name: 'Connect' })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
