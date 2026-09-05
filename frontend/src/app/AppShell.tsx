import { Link, Outlet } from 'react-router-dom';

/**
 * The signed-in frame: wordmark, navigation, and the score badge that plan.md §4
 * wants present on every page after onboarding.
 *
 * The badge reads from the map query's cache rather than fetching, so it costs
 * nothing on pages that already need the map and one shared request on pages
 * that don't. Wired in T-017, when `GET /topics/:id/map` exists.
 */
export function AppShell() {
  return (
    <>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '18px var(--s-8)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <Link to="/" className="serif" style={{ fontSize: 19, fontWeight: 600, color: 'var(--ink)' }}>
          learnos
        </Link>
        <nav style={{ display: 'flex', gap: 'var(--s-6)', alignItems: 'center' }}>
          <Link to="/session" style={{ fontSize: 14, color: 'var(--ink-2)' }}>
            Today
          </Link>
          <Link to="/map" style={{ fontSize: 14, color: 'var(--ink-2)' }}>
            Map
          </Link>
        </nav>
      </header>
      <main style={{ padding: 'var(--s-7) var(--s-8)' }}>
        <Outlet />
      </main>
    </>
  );
}
