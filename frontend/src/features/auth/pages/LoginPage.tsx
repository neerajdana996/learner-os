import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../../components/Button';
import { Field } from '../../../components/Field';
import { GitHubMark, GoogleMark } from '../../../components/Icon';
import { useDevLoginMutation, useRequestMagicLinkMutation } from '../authApi';

const API_URL = import.meta.env.VITE_API_URL ?? '/api';

/**
 * OAuth is a full-page navigation, not a fetch: the provider redirect chain has
 * to happen in the address bar, and the session comes back as an httpOnly
 * cookie the app never reads.
 */
const PROVIDERS = [
  { id: 'google', label: 'Continue with Google', Mark: GoogleMark },
  { id: 'github', label: 'Continue with GitHub', Mark: GitHubMark },
] as const;

/**
 * Dev sign-in (T-070). `import.meta.env.DEV` is a build-time constant, so this
 * whole block — button, credentials and all — is dropped from the production
 * bundle by dead-code elimination rather than merely hidden. The backend does
 * not register the route in production either; either lock alone would do.
 */
const DEV_CREDENTIALS = { email: 'dev@learnos.local', password: 'learnos' };

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [requestLink, { isLoading, isSuccess, error }] = useRequestMagicLinkMutation();
  const [devLogin, { isLoading: devLoggingIn, error: devError }] = useDevLoginMutation();
  const navigate = useNavigate();

  async function signInAsDev() {
    await devLogin(DEV_CREDENTIALS).unwrap();
    // The session is an httpOnly cookie the app never reads, so the route guard
    // decides where this lands — onboarding or the dashboard, depending on
    // whether this user has a topic yet.
    navigate('/', { replace: true });
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    await requestLink({ email });
  }

  return (
    <main className="centred-page">
      <div className="centred-page__inner u-stack u-stack--loose">
        <div className="brand">Js Ai Labs</div>

        {isSuccess ? (
          <div className="u-stack u-stack--tight">
            <h1>Check your inbox</h1>
            <p className="u-muted">
              If <strong>{email}</strong> is on the pilot list, a sign-in link is on its way. It
              works once and expires in fifteen minutes.
            </p>
          </div>
        ) : (
          <>
            <div className="u-stack u-stack--tight">
              <h1>Sign in</h1>
              <p className="u-muted">
                Thirty days, one topic, and a test at the end you won’t see coming.
              </p>
            </div>

            <div className="u-stack u-stack--tight">
              {PROVIDERS.map(({ id, label, Mark }) => (
                <a
                  key={id}
                  className="btn btn--secondary btn--block btn--lg btn--with-mark"
                  href={`${API_URL}/auth/oauth/${id}/start`}
                >
                  <Mark />
                  {label}
                </a>
              ))}
            </div>

            <div className="divider">
              <span className="divider__label">or</span>
            </div>

            <form className="u-stack" onSubmit={onSubmit}>
              <Field
                label="Email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={error ? 'That didn’t go through. Try again in a moment.' : null}
                hint="No password to forget. The link works once and expires in fifteen minutes."
              />
              <Button type="submit" block className="btn--lg" disabled={!email.trim() || isLoading}>
                {isLoading ? 'Sending…' : 'Email me a link'}
              </Button>
            </form>

            {/* What we collect, before anyone signs up rather than buried in a
                settings page — the product's whole proposition is that it
                measures you, so saying so here is the honest place. */}
            <p className="fine-print">
              We log what you answer and how long you took, because that&rsquo;s the measurement.{' '}
              <a href="/privacy">What we keep, in plain words</a>.
            </p>

            {import.meta.env.DEV && (
              <div className="dev-panel">
                <p className="dev-panel__label">Dev only — not in the production build</p>
                <Button
                  type="button"
                  block
                  className="btn--secondary"
                  disabled={devLoggingIn}
                  onClick={() => void signInAsDev()}
                >
                  {devLoggingIn ? 'Signing in…' : `Sign in as ${DEV_CREDENTIALS.email}`}
                </Button>
                {Boolean(devError) && (
                  <p className="dev-panel__label">
                    Dev sign-in failed. Is the backend running with NODE_ENV=development?
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
