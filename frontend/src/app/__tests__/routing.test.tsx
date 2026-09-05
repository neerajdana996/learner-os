import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { makeStore } from '../../store';
import { AppRoutes } from '../router';

/**
 * T-071. Every sign-in path lands on `/` — magic-link verify and OAuth both
 * redirect the browser there after setting the cookie — so what `/` decides is
 * the whole difference between "you are signed in" and "here is the sign-in
 * page again", which is what it used to show.
 */
function renderAt(path: string) {
  // The app's own store factory, not a hand-rolled one: AppShell reads the ui
  // slice, and a store missing it renders nothing at all.
  const store = makeStore();
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </Provider>,
  );
}

const fetchMock = vi.fn();

const ME = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'learner@example.com',
  name: null,
  timezone: 'Asia/Kolkata',
  activeWindows: [],
  profile: { dailyCap: 12, calibrationGap: null },
  hasExtensionToken: false,
};

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

/** Answers /me and /topics; everything else is an empty 200 so a screen that
 *  renders after the redirect doesn't explode on an unmocked call. */
function server({ me, topics }: { me: 'ok' | 401; topics?: unknown[] }) {
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.includes('/me')) return me === 'ok' ? json(ME) : json({ error: 'unauthorized' }, 401);
    if (url.endsWith('/topics')) return json({ topics: topics ?? [] });
    if (url.includes('/session')) return json({ newConcepts: [], dueReviews: [], completedToday: false });
    if (url.includes('/map')) return json({ topicId: topic('active').id, title: 'React Hooks', score: 0, concepts: [], edges: [] });
    return json({});
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const topic = (status: string) => ({
  id: '22222222-2222-4222-8222-222222222222',
  title: 'React Hooks',
  status,
  endsAt: null,
  counts: { concepts: 0, items: 0 },
});

describe('landing route', () => {
  it('shows the sign-in page when there is no session', async () => {
    server({ me: 401 });
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('sends a signed-in learner with no topic to onboarding', async () => {
    server({ me: 'ok', topics: [] });
    renderAt('/');
    expect(await screen.findByText(/step 1 of/i)).toBeInTheDocument();
  });

  it('sends a signed-in learner with an active topic to the dashboard', async () => {
    server({ me: 'ok', topics: [topic('active')] });
    renderAt('/');
    expect(await screen.findByText(/still recall today/)).toBeInTheDocument();
  });

  it('treats a topic that is still generating as not usable — onboarding owns the wait screen', async () => {
    server({ me: 'ok', topics: [topic('generating')] });
    renderAt('/');
    expect(await screen.findByText(/step 1 of/i)).toBeInTheDocument();
  });
});

describe('protected routes', () => {
  it('redirects to sign-in instead of rendering an empty screen', async () => {
    server({ me: 401 });
    renderAt('/session');
    // Before T-071 this rendered the player, fired 401s, and settled on a blank
    // page that looks like a bug rather than a logged-out state.
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('renders a protected screen when there is a session', async () => {
    server({ me: 'ok', topics: [topic('active')] });
    renderAt('/home');
    expect(await screen.findByText(/still recall today/)).toBeInTheDocument();
  });
});
