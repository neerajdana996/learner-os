import { Link } from 'react-router-dom';
import { CONTACT_EMAIL } from '../SiteFooter';
import { LegalPage } from '../LegalPage';

/**
 * What we collect and why (T-046).
 *
 * Written against what the code actually does rather than from a template:
 * every claim below is checkable in `schema.ts`, the extension manifest, or
 * the list of services the backend talks to. A policy that promises something
 * the product does not do is worse than none, because it is the one document
 * a reader is entitled to rely on.
 *
 * Self-serve export and deletion are real since T-046 (`GET /me/export`,
 * `DELETE /me`, both in the account menu), so the page now says so — and names
 * what the export leaves out, because a copy that silently omits things is the
 * kind of claim a reader is entitled to rely on. It still does not claim a DPO.
 *
 * The extension's permission list tracks `extension/wxt.config.ts`; `sidePanel`
 * joined it with T-170.
 */
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="15 September 2026">
      <p>
        Cold Recall is run by Neeraj Dana in Rajasthan, India. This page explains what the product
        stores about you, why it stores it, and how to get it back or have it deleted. For anything
        not covered here, write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Your account.</strong> Your email address, which is required because it is how
          you sign in. Optionally a display name. Your timezone and the hours you choose to be
          asked questions in, because every &ldquo;today&rdquo; in the product is your today.
        </li>
        <li>
          <strong>If you sign in with Google or GitHub.</strong> The account identifier and email
          address that provider gives us. We never receive your password.
        </li>
        <li>
          <strong>Your learning.</strong> The topics you ask for, the concept map generated for
          them, your answers, how confident you said you were, and the scheduling state that
          decides when you are asked again. This is the product; without it there is nothing to
          show you.
        </li>
        <li>
          <strong>Product events.</strong> Which screens you reach and which actions you take, so
          we can tell a feature nobody uses from one that is broken.
        </li>
        <li>
          <strong>Technical.</strong> A sign-in cookie, and ordinary server logs which include your
          IP address and browser.
        </li>
      </ul>
      <p>
        We do not ask for, and have no way to take, payment details. We do not buy data about you
        and we do not sell or rent anything we hold.
      </p>

      <h2>The Chrome extension</h2>
      <p>
        The extension asks one question at a time, in hours you choose. It{' '}
        <strong>cannot read the pages you visit</strong> — and that is a property of how it is
        built, not a promise. It ships with no content scripts and without the{' '}
        <code>tabs</code> permission, so the browser never grants it access to your tabs. The
        permissions it does request are storage, alarms, notifications, idle and the side panel it
        opens in, plus permission to talk to our own API.
      </p>

      <h2>Why we process it</h2>
      <p>
        To sign you in, to generate and teach your topics, to schedule reviews, to run the recall
        check weeks later, to email you about your own account, and to keep the service working and
        secure. You give consent by creating an account, and you can withdraw it at any time by
        deleting your account — see below.
      </p>

      <h2>Who else processes it</h2>
      <ul>
        <li>
          <strong>OpenAI</strong> — generates the concept map and questions from the topic you
          type. It receives the topic and the material being generated. It does not receive your
          email address or your answers.
        </li>
        <li>
          <strong>Mailgun</strong> — sends your sign-in links and notifications. It receives your
          email address.
        </li>
        <li>
          <strong>Amazon Web Services</strong> — hosts the application and the database, in the
          Mumbai (ap-south-1) region.
        </li>
        <li>
          <strong>Google or GitHub</strong> — only if you choose to sign in with them.
        </li>
      </ul>
      <p>
        OpenAI and Mailgun process data outside India. We use them because there is no way to run
        this product without a model provider and a mail provider.
      </p>

      <h2>How long we keep it</h2>
      <p>
        For as long as your account exists. The whole point of the product is to ask you something
        weeks after you learned it, so learning data is not short-lived by nature. When you delete
        your account we remove it and everything attached to it, straight away. Ordinary server logs
        age out on their own.
      </p>

      <h2>Your rights</h2>
      <p>
        Once signed in, open the account menu (the circle with your initial, top right) to{' '}
        <strong>download a copy of your data</strong> or <strong>delete your account</strong>.
        Deleting is immediate and cannot be undone: your account, topics, answers and schedule are
        all removed, and the Chrome extension is signed out.
      </p>
      <p>
        The copy leaves out two things on purpose: the answer keys to the questions, and the names
        of the concepts deliberately never taught to you. Cold Recall checks weeks later what you
        still remember, and seeing either beforehand would change the answer. Sign-in secrets are
        left out too.
      </p>
      <p>
        To correct something, or if you cannot sign in, email{' '}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and a person — currently me — will
        do it.
      </p>
      <p>
        If you are unhappy with how we have handled a request, say so in reply and it will be
        treated as a grievance and answered rather than filed.
      </p>

      <h2>Children</h2>
      <p>Cold Recall is not intended for anyone under 18, and we do not knowingly create accounts for them.</p>

      <h2>Security</h2>
      <p>
        Traffic is encrypted in transit. Sign-in links are single-use, expire, and are stored only
        as hashes, so a copy of the database does not let anyone sign in as you. No system is
        perfect; if we ever discover a breach affecting you, we will tell you.
      </p>

      <h2>Changes</h2>
      <p>
        If this page changes in a way that affects you, the date at the top changes with it. See
        also the <Link to="/terms">terms</Link>.
      </p>

    </LegalPage>
  );
}
