import { Outlet } from 'react-router-dom';
import { AppBar } from './AppBar';

/**
 * The signed-in frame. plan.md §4 wants the knowledge score on every page; it
 * lives in the bar rather than being repeated by each screen (T-081).
 */
export function AppShell() {
  return (
    <>
      <AppBar />
      <main className="app-main">
        <Outlet />
      </main>
    </>
  );
}
