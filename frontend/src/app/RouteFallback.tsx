/**
 * Shown while a route chunk loads.
 *
 * Deliberately not a spinner: on a warm cache these chunks resolve in a few
 * milliseconds, and a spinner that flashes for 30ms reads as jank. This holds
 * the layout open and stays invisible until the wait is long enough to be worth
 * acknowledging.
 */
export function RouteFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{ minHeight: '50vh', display: 'grid', placeItems: 'center' }}
    >
      <span className="sr-only">Loading</span>
      <span
        aria-hidden="true"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: 'var(--muted)',
          opacity: 0,
          animation: 'route-fallback-in 1ms linear 400ms forwards',
        }}
      >
        one moment
      </span>
      <style>{`@keyframes route-fallback-in { to { opacity: 1 } }`}</style>
    </div>
  );
}
