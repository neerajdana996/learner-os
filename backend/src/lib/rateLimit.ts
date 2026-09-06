/**
 * A fixed-window counter, in memory (T-FIX-007).
 *
 * In memory is enough for the pilot: one backend process, ten learners. If the
 * API is ever run with more than one replica this becomes per-replica and the
 * effective limit multiplies by the replica count — at which point it should
 * move to Redis, which is already a dependency. Noted rather than built, since
 * building it now would be building ahead of the sprint (loop.md §7).
 *
 * The clock is injected so the window-expiry test doesn't have to sleep.
 */
export interface RateLimiter {
  /** True when the call is allowed; false once the limit is spent. */
  check(key: string, now?: number): boolean;
  reset(): void;
}

export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return {
    check(key, now = Date.now()) {
      // Sweep expired entries so a stream of distinct keys (one per attacker
      // email) can't grow the map without bound.
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);

      const entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        hits.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }
      if (entry.count >= limit) return false;
      entry.count += 1;
      return true;
    },
    reset() {
      hits.clear();
    },
  };
}
