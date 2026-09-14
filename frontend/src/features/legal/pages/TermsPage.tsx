import { Link } from 'react-router-dom';
import { CONTACT_EMAIL } from '../SiteFooter';
import { LegalPage } from '../LegalPage';

/**
 * The terms (T-046).
 *
 * Short on purpose. The clause that actually matters here is the one about
 * generated material: a model writes the concept map and the questions, it is
 * sometimes wrong, and the product's own landing page already says so. Terms
 * that quietly implied the content was verified would contradict the pitch.
 */
export default function TermsPage() {
  return (
    <LegalPage title="Terms" updated="14 September 2026">
      <p>
        Cold Recall is operated by Neeraj Dana, Rajasthan, India. By creating an account you agree
        to what is on this page. If you do not, please do not create one.
      </p>

      <h2>What you get</h2>
      <p>
        Cold Recall is in early access and free to use. It is a single-person project, which means
        features change, things occasionally break, and there is no guaranteed uptime. If the
        service is ever going to shut down, you will be told with enough notice to get your data
        out.
      </p>

      <h2>Your account</h2>
      <p>
        One account per person, with a real address you control, because that address is how you
        sign in — a sign-in link sent to it is enough to get into your account, so treat it the way
        you would a password. Tell us if you think someone else has access.
      </p>

      <h2>The material is generated, and it can be wrong</h2>
      <p>
        The concept map, the explanations and the questions are produced by an AI model. They are
        not written or checked line by line by a human unless the topic says so. They can be
        subtly, confidently wrong.
      </p>
      <p>
        So: use your judgement, and do not rely on anything here where being wrong carries a real
        cost — an exam, a medical or legal question, production code you cannot review. You are
        responsible for what you do with the material. If you find a bad question, flag it; that is
        how the bad ones get retired.
      </p>

      <h2>Fair use</h2>
      <p>
        Do not try to break, overload or probe the service, scrape it, resell it, or use it to
        generate unlawful material. Automated access outside normal use of the product is not
        allowed. We may suspend an account doing any of that.
      </p>

      <h2>Your content</h2>
      <p>
        The topics you type and the answers you give remain yours. You give us permission to
        process them for the single purpose of running the product for you, as described in the{' '}
        <Link to="/privacy">privacy page</Link>. We do not use your answers to train models.
      </p>

      <h2>Ending it</h2>
      <p>
        You can stop at any time and ask us to delete your account by emailing{' '}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. We can close an account that
        breaks these terms, and will say why.
      </p>

      <h2>No warranty, and what we are liable for</h2>
      <p>
        The service is provided as it is, without warranties of any kind. To the extent the law
        allows, we are not liable for indirect or consequential loss, lost data, or anything you
        lost by relying on generated material. Nothing here limits liability that cannot legally be
        limited.
      </p>

      <h2>Changes</h2>
      <p>
        These terms can change. The date at the top changes with them, and a change that materially
        affects you will be emailed rather than quietly published.
      </p>

      <h2>Law</h2>
      <p>
        These terms are governed by the laws of India, and the courts of Rajasthan have
        jurisdiction. Questions: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}
