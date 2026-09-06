import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // DB tests share one Postgres database; run files serially to avoid truncate races.
    fileParallelism: false,
    /**
     * Explicit, because the default is 5s and the integration suites cross it
     * under load (T-100).
     *
     * The failure that finds you is not a timeout message. Vitest gives up on
     * the test and moves on, but a JS promise cannot be cancelled, so the
     * abandoned chain keeps issuing requests while the *next* test's
     * `beforeEach` truncates the tables underneath it — and the orphaned
     * requests come back 401. It reads as a random auth flake in a different
     * test each run.
     *
     * 20s against a ~35s whole suite: enough headroom for a busy machine,
     * still short enough that a genuinely hung test fails rather than hangs.
     */
    testTimeout: 20_000,
    /**
     * Explicit, because the default is **10s** — half the test timeout — and
     * `beforeEach(truncateAll)` is a database round trip that runs before every
     * test in the suite.
     *
     * A hook that times out is worse than a test that does: vitest reports the
     * hook failure against whichever test was next, and the tables are left
     * in whatever state the truncate reached. The symptom is an assertion
     * failure in a test that has nothing to do with the cause.
     */
    hookTimeout: 20_000,
  },
});
