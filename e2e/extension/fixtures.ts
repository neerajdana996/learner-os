import { test as base, chromium, type BrowserContext } from '@playwright/test';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXTENSION = fileURLToPath(new URL('../../extension/.output/chrome-mv3', import.meta.url));

/**
 * A browser with the unpacked extension actually loaded.
 *
 * Three things make this different from an ordinary Playwright context:
 *
 *  - **A persistent context is required.** `--load-extension` is a
 *    profile-level flag, so there is no way to load an extension into a plain
 *    `browser.newContext()`. That means the video and trace options from
 *    `use:` do not apply, and `recordVideo` has to be passed here by hand —
 *    which is why this fixture attaches the video to the report itself.
 *  - **Headed, not headless.** Chromium's old headless mode cannot run MV3
 *    extensions at all. This launches a real window; on CI that needs a
 *    display (`xvfb-run -a pnpm e2e`).
 *  - **The extension id is discovered, not configured.** It is derived from
 *    the profile's key, so it changes with the profile. The service worker's
 *    own URL is the only reliable source of it.
 */
export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  context: async ({}, use, testInfo) => {
    if (!existsSync(EXTENSION)) {
      throw new Error(
        `e2e: no extension build at ${EXTENSION}. ` +
          'Run `pnpm --filter learner-os-extension build` (global-setup does this for you).',
      );
    }

    const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'learnos-ext-'));
    const videoDir = testInfo.outputPath('video');

    const context = await chromium.launchPersistentContext(profile, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION}`,
        `--load-extension=${EXTENSION}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
      // The popup's real width. A card designed for 380px and screenshotted at
      // 1280 is a screenshot of a layout no learner ever sees (T-130).
      viewport: { width: 460, height: 720 },
      recordVideo: { dir: videoDir },
    });

    await use(context);
    await context.close();

    // Videos are only flushed on close, so this has to happen after it.
    for (const file of await fs.readdir(videoDir).catch(() => [])) {
      await testInfo.attach(`video-${file}`, {
        path: path.join(videoDir, file),
        contentType: 'video/webm',
      });
    }
    await fs.rm(profile, { recursive: true, force: true });
  },

  extensionId: async ({ context }, use) => {
    // The MV3 service worker starts on load, but not necessarily before the
    // first test statement — so wait for it rather than racing it.
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
    await use(new URL(worker.url()).host);
  },
});

export const expect = test.expect;
