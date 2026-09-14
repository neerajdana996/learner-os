import { Link } from 'react-router-dom';
import { CONTACT_EMAIL } from '../SiteFooter';
import { LegalPage } from '../LegalPage';

/**
 * How to reach a person (T-046).
 *
 * One address, answered by one person, with an honest turnaround rather than a
 * "within 24 hours" nobody intends to meet. A contact page that overpromises
 * is worse than the absence it replaced.
 */
export default function ContactPage() {
  return (
    <LegalPage title="Contact" updated="14 September 2026">
      <p>
        Cold Recall is built and run by one person. Everything below reaches me directly — there is
        no ticket queue and no bot in front of it.
      </p>

      <p className="legal__lede">
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>

      <h2>What to write about</h2>
      <ul>
        <li>
          <strong>Something is broken,</strong> or a question is wrong. Say which topic and, if you
          can, paste the question — a bad question can be retired so nobody else gets it.
        </li>
        <li>
          <strong>Your data.</strong> A copy of it, a correction, or deletion of your account and
          everything attached. See the <Link to="/privacy">privacy page</Link> for what is held.
        </li>
        <li>
          <strong>Anything about the beta</strong> — whether it suits what you are learning, or why
          you stopped. The second one is more useful than the first.
        </li>
      </ul>

      <h2>How long it takes</h2>
      <p>
        Usually a couple of working days. If it concerns your data, it will be acted on inside a
        week and you will get a reply saying what was done, rather than silence.
      </p>

      <h2>Where this is run from</h2>
      <p>
        Neeraj Dana
        <br />
        Rajasthan, India
      </p>
    </LegalPage>
  );
}
