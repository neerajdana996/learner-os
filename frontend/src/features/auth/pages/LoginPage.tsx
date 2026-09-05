import { useState, type FormEvent } from 'react';
import { Button } from '../../../components/Button';
import { Field } from '../../../components/Field';
import { useRequestMagicLinkMutation } from '../authApi';

const API_URL = import.meta.env.VITE_API_URL ?? '/api';

/**
 * OAuth is a full-page navigation, not a fetch: the provider redirect chain has
 * to happen in the address bar, and the session comes back as an httpOnly
 * cookie the app never reads.
 */
const PROVIDERS = [
  { id: 'google', label: 'Continue with Google' },
  { id: 'github', label: 'Continue with GitHub' },
] as const;

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [requestLink, { isLoading, isSuccess, error }] = useRequestMagicLinkMutation();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    await requestLink({ email });
  }

  return (
    <main className="centred-page">
      <div className="centred-page__inner u-stack u-stack--loose">
        <div className="brand">learnos</div>

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
              {PROVIDERS.map((provider) => (
                <a
                  key={provider.id}
                  className="btn btn--secondary btn--block btn--lg"
                  href={`${API_URL}/auth/oauth/${provider.id}/start`}
                >
                  {provider.label}
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
                hint="No password to forget."
              />
              <Button type="submit" block className="btn--lg" disabled={!email.trim() || isLoading}>
                {isLoading ? 'Sending…' : 'Email me a link'}
              </Button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
