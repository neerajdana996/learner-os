import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { makeStore } from '../../store';
import { AppRoutes } from '../router';

/**
 * T-047, the outer boundary. The screen boundary inside `AppShell` cannot catch
 * the bar, which renders beside it. Found while testing the inner one: a
 * session response missing `newConcepts` made the bar throw, and the page went
 * completely blank. Here the bar is made to throw on purpose.
 */
vi.mock('../AppBar', () => ({
  AppBar: () => {
    throw new Error('the bar could not read its data');
  },
}));

const fetchMock = vi.fn();

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

const ME = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'learner@example.com',
  name: null,
  timezone: 'Asia/Kolkata',
  activeWindows: [],
  profile: { dailyCap: 12, calibrationGap: null },
  hasExtensionToken: false,
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.includes('/me')) return json(ME);
    if (url.endsWith('/topics')) return json({ topics: [] });
    if (url.includes('/session')) return json({ newConcepts: [], dueReviews: [], completedToday: false });
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the outermost error boundary', () => {
  it('shows an explanation, not a blank page, when the bar itself throws', async () => {
    const { container } = render(
      <Provider store={makeStore()}>
        <MemoryRouter initialEntries={['/home']}>
          <AppRoutes />
        </MemoryRouter>
      </Provider>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('This screen stopped working.');
    expect(screen.getByRole('alert')).toHaveTextContent('the bar could not read its data');
    expect(container).not.toBeEmptyDOMElement();
  });
});
