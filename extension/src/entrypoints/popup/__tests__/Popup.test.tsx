import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeBrowser } from 'wxt/testing';
import { browser } from 'wxt/browser';
import { Popup } from '../Popup';
import { setToken } from '../../../lib/storage';

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
