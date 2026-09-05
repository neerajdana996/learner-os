import { Link, Outlet } from 'react-router-dom';
import { ThemeToggle } from './ThemeToggle';

/**
 * The signed-in frame. The score badge that plan.md §4 wants on every page
 * lands here in T-017, reading from the map query's cache rather than fetching.
 */
export function AppShell() {
  return (
    <>
      <header className="app-header">
        <Link className="app-header__brand" to="/">
          learnos
        </Link>
        <nav className="app-header__nav">
          <Link className="app-header__link" to="/session">
            Today
          </Link>
          <Link className="app-header__link" to="/map">
            Map
          </Link>
          <ThemeToggle />
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </>
  );
}
