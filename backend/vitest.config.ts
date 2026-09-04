import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // DB tests share one Postgres database; run files serially to avoid truncate races.
    fileParallelism: false,
  },
});
