import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing';

export default defineConfig({
  // WxtVitest gives every test WXT's auto-imports and `fakeBrowser` — an
  // in-memory `chrome.*` — so storage and messaging behave like the real thing
  // without a browser.
  plugins: [WxtVitest()],
  test: {
    // happy-dom, matching the frontend: the popup and options page are React,
    // and a UI nobody can test is a UI that breaks quietly.
    environment: 'happy-dom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
