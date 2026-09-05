import { useHealthQuery } from '../store/api';

/** Where the API lives, for the OAuth links. These are full-page navigations,
 *  not fetches: the provider redirect chain has to happen in the address bar,
 *  and the session comes back as an httpOnly cookie the app never reads. */
const API_URL = import.meta.env.VITE_API_URL ?? '/api';

/**
 * Login page. The OAuth buttons are live (T-055); the magic-link form is T-018.
 */
export function LoginPage() {
  const health = useHealthQuery();

  return (
    <main>
      <h1>learnos</h1>
      <p className="muted">Remember what you learn.</p>

      <div className="signin">
        <a className="btn" href={`${API_URL}/auth/oauth/google/start`}>
          Continue with Google
        </a>
        <a className="btn" href={`${API_URL}/auth/oauth/github/start`}>
          Continue with GitHub
        </a>
      </div>
      <p className="muted">Email sign-in arrives with onboarding (T-018).</p>
      <div className="status" data-testid="backend-status">
        Backend:{' '}
        {health.isLoading ? (
          <span>checking…</span>
        ) : health.isSuccess ? (
          <span className="ok">online</span>
        ) : (
          <span className="bad">offline</span>
        )}
      </div>
    </main>
  );
}
