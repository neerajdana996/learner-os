import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Provider } from 'react-redux';
import { makeStore } from '../../store';
import { AppShell } from '../AppShell';
import { ErrorBoundary } from '../ErrorBoundary';

/**
 * T-047. The web app had no error boundary: one screen throwing unmounted the
 * whole tree and left a blank white page, with the error only in the console.
 */
const fetchMock = vi.fn();

function json(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

function Boom(): never {
  throw new Error('newConcepts is undefined');
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
  /**
   * Real response shapes, as `routing.test.tsx` uses. A blanket `{}` made the
   * bar itself throw (`session?.newConcepts.length`), and the bar sits outside
   * the screen's boundary — so the whole tree unmounted to a blank page, which
   * is the failure this task exists to prevent, caused by the stub.
   */
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.includes('/me')) return json(ME);
    if (url.endsWith('/topics')) return json({ topics: [] });
    if (url.includes('/session')) return json({ newConcepts: [], dueReviews: [], completedToday: false });
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  // React logs every caught render error; the boundary logs it again. Both are
  // expected here and would only bury real test output.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the app shell’s error boundary', () => {
  it('replaces a screen that throws with an explanation, and the bar survives', async () => {
    render(
      <Provider store={makeStore()}>
        <MemoryRouter initialEntries={['/home']}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/home" element={<Boom />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </Provider>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('This screen stopped working.');
    // The shell outside the boundary is still rendered — not a blank page. The
    // account menu lives in the bar, so finding its trigger proves the bar
    // survived, and that the learner can still reach sign-out.
    expect(screen.getByRole('button', { name: /^Account/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to today' })).toHaveAttribute('href', '/home');
  });
});

describe('ErrorBoundary', () => {
  it('says what broke, and never shows a stack', () => {
    render(
      <MemoryRouter>
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>
      </MemoryRouter>,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('newConcepts is undefined');
    expect(alert.textContent).not.toMatch(/at Boom|\.tsx:\d+/);
  });

  it('renders the screen again when Try again is pressed and it no longer throws', async () => {
    const user = userEvent.setup();
    let broken = true;
    function Flaky() {
      if (broken) throw new Error('transient');
      return <p>Recovered screen</p>;
    }

    render(
      <MemoryRouter>
        <ErrorBoundary>
          <Flaky />
        </ErrorBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    broken = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByText('Recovered screen')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears a caught error when the reset key changes, as it does on navigation', () => {
    let broken = true;
    function Flaky() {
      if (broken) throw new Error('only on the first screen');
      return <p>The next screen</p>;
    }

    const { rerender } = render(
      <MemoryRouter>
        <ErrorBoundary resetKey="/session">
          <Flaky />
        </ErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    broken = false;
    rerender(
      <MemoryRouter>
        <ErrorBoundary resetKey="/map">
          <Flaky />
        </ErrorBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByText('The next screen')).toBeInTheDocument();
  });
});
