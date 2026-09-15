import { Outlet, useLocation } from 'react-router-dom';
import { AppBar } from './AppBar';
import { ErrorBoundary } from './ErrorBoundary';

/**
 * The signed-in frame. plan.md §4 wants the knowledge score on every page; it
 * lives in the bar rather than being repeated by each screen (T-081).
 *
 * The routed screen sits inside an error boundary and the bar outside it
 * (T-047): a screen that throws is replaced by an explanation, and the bar and
 * account menu stay, so the learner can still get somewhere. Keyed on the path
 * so moving to another screen clears a caught error.
 */
export function AppShell() {
  const { pathname } = useLocation();
  return (
    <>
      <AppBar />
      <main className="app-main">
        <ErrorBoundary resetKey={pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </>
  );
}
