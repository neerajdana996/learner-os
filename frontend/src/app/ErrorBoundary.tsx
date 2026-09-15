import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@learnos/ui';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** When this changes, a caught error is cleared — the shell passes the path,
   *  so navigating away from a broken screen gives the next one a fresh start. */
  resetKey?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * The web app's error boundary (T-047).
 *
 * There was none anywhere. A `GET /session` response missing `newConcepts`
 * made `DashboardPage` throw on `.length`, React unmounted the whole tree, and
 * a learner got a blank white page with the error only in the console — the
 * worst possible failure for a pilot participant, who has nothing to report but
 * "it stopped working".
 *
 * It sits inside `AppShell`, around the routed screen only, so the bar and the
 * account menu survive whatever the screen did. It says what broke, keeps the
 * learner's way out, and never shows a stack.
 *
 * A class, because React still has no hook for catching render errors.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Nowhere better to send it yet: error reporting (a Sentry DSN) is the
    // optional half of T-047 and is not configured.
    console.error('A screen crashed', error, info.componentStack);
  }

  override componentDidUpdate(previous: ErrorBoundaryProps) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="u-stack u-stack--loose" role="alert">
        <p className="u-eyebrow">Something broke</p>
        <h1>This screen stopped working.</h1>
        <p className="u-muted">
          Anything you already submitted is saved. Try again, or go back to today’s screen.
        </p>
        <p className="u-muted">
          What broke: <code>{error.message || 'an unknown error'}</code>
        </p>
        <div className="u-row">
          <Button type="button" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
          <Link className="btn btn--quiet" to="/home">
            Back to today
          </Link>
        </div>
      </div>
    );
  }
}
