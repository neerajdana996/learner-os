import { defineConfig, devices } from '@playwright/test';

/**
 * Integration tests across both surfaces (T-134).
 *
 * These run against the **real backend and a real Postgres** — not mocks. The
 * vitest suites already cover the units and the contracts; what nothing covered
 * before this is whether the screens, the API and the shared design system
 * actually work when wired together, and whether the extension's popup renders
 * the same card the web app does.
 *
 * `workers: 1` and `fullyParallel: false` are deliberate: there is one seeded
 * learner with one topic and a scheduler with real state, so two tests
 * answering cards at once would be racing over the same review queue. This
 * suite is slow by nature; it is not the one you run on every save.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.artifacts',
  globalSetup: './e2e/global-setup.ts',

  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },

  // The HTML report is the deliverable: it carries the screenshots, the video
  // of every test and a trace you can step through frame by frame.
  reporter: [
    ['list'],
    ['html', { outputFolder: 'e2e/report', open: 'never' }],
  ],

  use: {
    baseURL: 'http://localhost:5173',
    // `on`, not `retain-on-failure`: the point of this suite is to be *watched*
    // — a passing run is how you see the product working, and a founder
    // reviewing a screen should not have to break it first to get a video.
    video: 'on',
    screenshot: 'on',
    trace: 'on',
    actionTimeout: 20_000,
  },

  projects: [
    { name: 'web', testDir: './e2e/web', use: { ...devices['Desktop Chrome'] } },
    // No `devices` entry: the extension project builds its own persistent
    // context, because an unpacked MV3 extension cannot be loaded into a
    // plain browser context. See e2e/extension/fixtures.ts.
    { name: 'extension', testDir: './e2e/extension' },
  ],

  // Started only if they are not already up, so a dev server you are already
  // running is reused rather than fought with.
  webServer: [
    {
      command: 'pnpm --filter learner-os-backend dev',
      url: 'http://localhost:3001/health',
      reuseExistingServer: true,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'pnpm --filter learner-os-frontend dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
