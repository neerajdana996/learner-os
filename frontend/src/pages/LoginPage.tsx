import { useHealthQuery } from '../store/api';

/**
 * Placeholder login page so the Sprint-1 exit criterion ("frontend serves the
 * login page") holds. The magic-link form is T-018.
 */
export function LoginPage() {
  const health = useHealthQuery();

  return (
    <main>
      <h1>learnos</h1>
      <p className="muted">Remember what you learn. Sign-in arrives in Sprint 2.</p>
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
