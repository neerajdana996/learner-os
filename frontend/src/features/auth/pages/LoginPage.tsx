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
const providers = [
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
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '60px 24px' }}>
      <div style={{ width: '100%', maxWidth: 396 }}>
        <div className="serif" style={{ fontSize: 22, fontWeight: 600, marginBottom: 40 }}>
          learnos
        </div>

        {isSuccess ? (
          <>
            <h1 style={{ fontSize: 34, marginBottom: 10 }}>Check your inbox</h1>
            <p style={{ fontSize: 15, color: 'var(--ink-2)' }}>
              If <strong>{email}</strong> is on the pilot list, a sign-in link is on its way. It works
              once and expires in fifteen minutes.
            </p>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 34, marginBottom: 10 }}>Sign in</h1>
            <p style={{ fontSize: 15, color: 'var(--ink-2)', marginBottom: 32 }}>
              Thirty days, one topic, and a test at the end you won&rsquo;t see coming.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 26 }}>
              {providers.map((provider) => (
                <a
                  key={provider.id}
                  href={`${API_URL}/auth/oauth/${provider.id}/start`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--surface)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: 'var(--radius)',
                    minHeight: 'var(--tap)',
                    fontSize: 15,
                    fontWeight: 500,
                    color: 'var(--ink)',
                  }}
                >
                  {provider.label}
                </a>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 26 }}>
              <div style={{ height: 1, background: 'var(--border)', flexGrow: 1 }} />
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>or</div>
              <div style={{ height: 1, background: 'var(--border)', flexGrow: 1 }} />
            </div>

            <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <Field
                label="Email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={error ? 'That didn’t go through. Try again in a moment.' : null}
              />
              <Button type="submit" disabled={!email.trim() || isLoading} style={{ width: '100%' }}>
                {isLoading ? 'Sending…' : 'Email me a link'}
              </Button>
            </form>

            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 18 }}>
              No password to forget.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
