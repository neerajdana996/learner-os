import { describe, expect, it } from 'vitest';
import { env } from '../lib/env.js';

/**
 * Companion to networkGuard.test.ts, for the other shared resource (T-068).
 *
 * Three suites call `queue.obliterate({ force: true })` in `beforeEach`. On the
 * dev Redis database that deletes whatever generation job is actually running —
 * it happened, and the topic was left stuck on `generating` with nothing left
 * to finish it. Postgres has been isolated since T-002; this is the same
 * guarantee for Redis, asserted rather than assumed.
 */
describe('test isolation', () => {
  it('never points at Redis database 0, where dev jobs live', () => {
    const url = new URL(env.REDIS_URL);
    expect(url.pathname === '' || url.pathname === '/' || url.pathname === '/0').toBe(false);
  });

  it('never points at the dev Postgres database', () => {
    expect(new URL(env.DATABASE_URL).pathname).not.toBe('/learnos');
  });
});
