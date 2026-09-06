import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // happy-dom for the same reason the web app uses it (frontend/vite.config.ts):
    // jsdom's own AbortController fails Node fetch's instanceof checks.
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
  },
});
