/**
 * Shown while a route chunk loads. Held invisible for 400ms by `u-delayed-in`:
 * on a warm cache these resolve in milliseconds, and a spinner that flashes and
 * vanishes reads as jank.
 */
export function RouteFallback() {
  return (
    <div className="route-fallback" role="status" aria-live="polite">
      <span className="u-sr-only">Loading</span>
      <span className="u-mono u-muted u-delayed-in" aria-hidden="true">
        one moment
      </span>
    </div>
  );
}
