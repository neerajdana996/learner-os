import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { SiteFooter } from './SiteFooter';

/**
 * The frame every legal page shares (T-046).
 *
 * These pages are read by two audiences with nothing in common: someone
 * deciding whether to trust the product with their email address, and someone
 * checking whether a real business is behind the domain. Both want the same
 * thing — a page that looks maintained and says who wrote it — so the title,
 * the last-updated date and the footer live here rather than in each page.
 *
 * Public on purpose: a privacy policy behind a login is not a privacy policy.
 */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  /** Shown verbatim. A policy with no date gives a reader no way to tell
   *  whether it still describes the product they are about to use. */
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="landing legal">
      <header className="landing__nav">
        <div className="landing__inner landing__nav-inner">
          <Link className="landing__brand" to="/">
            Cold Recall
          </Link>
          <nav className="landing__nav-links">
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <Link to="/contact">Contact</Link>
          </nav>
        </div>
      </header>

      <main className="landing__section">
        <div className="landing__inner legal__body">
          <h1 className="legal__title">{title}</h1>
          <p className="legal__updated">Last updated {updated}</p>
          {children}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
