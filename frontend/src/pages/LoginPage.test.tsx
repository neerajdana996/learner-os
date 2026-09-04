import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { makeStore } from '../store';
import { LoginPage } from './LoginPage';

function renderPage() {
  return render(
    <Provider store={makeStore()}>
      <LoginPage />
    </Provider>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows "online" when /health responds ok via RTK Query', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    renderPage();
    expect(await screen.findByText('online')).toBeInTheDocument();
  });

  it('shows "offline" when the backend is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network'));
    renderPage();
    expect(await screen.findByText('offline')).toBeInTheDocument();
  });
});
