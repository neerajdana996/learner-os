import { Component, type ErrorInfo, type ReactNode } from 'react';
import { record } from '../../lib/telemetry';

/**
 * A card that fails to render must not be a blank 380×300 rectangle (T-035).
 *
 * An extension popup has no console anyone will open and no error overlay, so
 * an exception in the renderer is completely silent: the learner sees an empty
 * white box, closes it, and nothing anywhere records that the question was
 * lost. `popup_error` is the only way that becomes visible.
 *
 * The fallback deliberately does **not** offer to retry. The same item would be
 * rendered by the same code and fail the same way, and a button that does
 * nothing twice is worse than an honest dead end.
 */
export class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Buffered, not sent: the popup may be closed a moment from now, and the
    // worker's alarm is what actually delivers this (see lib/telemetry.ts).
    void record('popup_error', {
      message: error.message.slice(0, 200),
      component: (info.componentStack ?? '').split('\n')[1]?.trim().slice(0, 100) ?? 'unknown',
    });
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="card card--notice" role="alert">
        <p className="card__backoff">This question didn’t load.</p>
        <p className="card__backoff-sub">
          Nothing is lost — it stays in the queue and we’ll bring it back. We’ve logged what went
          wrong.
        </p>
      </main>
    );
  }
}
