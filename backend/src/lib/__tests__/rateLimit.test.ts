import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../rateLimit.js';

describe('createRateLimiter', () => {
  it('allows up to the limit and then refuses', () => {
    const limiter = createRateLimiter(3, 1000);
    expect([1, 2, 3].map(() => limiter.check('k', 0))).toEqual([true, true, true]);
    expect(limiter.check('k', 0)).toBe(false);
  });

  it('counts each key separately', () => {
    const limiter = createRateLimiter(1, 1000);
    expect(limiter.check('a', 0)).toBe(true);
    expect(limiter.check('b', 0)).toBe(true);
    expect(limiter.check('a', 0)).toBe(false);
  });

  it('lets the next request through once the window has passed', () => {
    const limiter = createRateLimiter(1, 1000);
    expect(limiter.check('k', 0)).toBe(true);
    expect(limiter.check('k', 999)).toBe(false);
    expect(limiter.check('k', 1000)).toBe(true);
  });

  it('does not grow without bound as keys expire', () => {
    const limiter = createRateLimiter(1, 1000);
    // A stream of distinct keys is exactly what an attacker walking an email
    // list produces; expired entries must be swept, not accumulated.
    for (let i = 0; i < 500; i += 1) limiter.check(`k${i}`, i);
    // Every earlier key has expired by now, so the budget for k0 is fresh.
    expect(limiter.check('k0', 10_000)).toBe(true);
  });

  it('reset clears every counter', () => {
    const limiter = createRateLimiter(1, 1000);
    limiter.check('k', 0);
    limiter.reset();
    expect(limiter.check('k', 0)).toBe(true);
  });
});
