import { Link } from 'react-router-dom';

/**
 * The public footer (T-046).
 *
 * Shared by the landing page and the legal pages rather than written twice:
 * the footer is where a stranger looks for who runs this and how to reach
 * them, and two copies drift the moment one is edited.
 *
 * It carries a real contact address on purpose. A product that asks for an
 * email address and offers no way to reach a human reads as abandoned, and
 * India's DPDP Act expects a named contact for data questions rather than a
 * form that goes nowhere.
 */

/** One address, named here so the contact page and the privacy page cannot
 *  disagree with the footer about where to write. */
export const CONTACT_EMAIL = 'neeraj.dana@coldrecall.info';

export function SiteFooter() {
  return (
    <footer className="landing__foot">
      <div className="landing__inner landing__foot-inner">
        <div className="u-stack u-stack--tight">
          <span className="site-foot__brand">Cold Recall</span>
          <span>Operated by Neeraj Dana &middot; Rajasthan, India</span>
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </div>

        <nav className="site-foot__links" aria-label="Footer">
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/contact">Contact</Link>
          <Link to="/signin">Sign in</Link>
        </nav>
      </div>
    </footer>
  );
}
