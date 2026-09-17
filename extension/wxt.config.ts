import { fileURLToPath } from 'node:url';
import { defineConfig } from 'wxt';

/**
 * The backend origin is baked into the manifest's host permission, so it comes
 * from the same `WXT_API_URL` the runtime reads (`lib/api.ts`) — two sources
 * would drift, and the symptom would be a fetch blocked by the manifest rather
 * than an error anyone can read. Changing it needs a rebuild, as any manifest
 * change does.
 */
const API_URL = process.env.WXT_API_URL ?? 'http://localhost:3001';

export default defineConfig({
  srcDir: 'src',
  /**
   * Not 3000 — that is the web app (T-127).
   *
   * WXT's dev server defaults to 3000, the same port `docker compose` publishes
   * the frontend on. Both bind successfully because they take different stacks:
   * Docker listens on `*:3000` and WXT on `[::1]:3000`. macOS resolves
   * `localhost` to `::1` first, so with the extension dev server running,
   * `http://localhost:3000` silently serves **WXT's 404** instead of the web
   * app — no error anywhere, and the frontend container looks broken while
   * `127.0.0.1:3000` works fine.
   */
  dev: { server: { port: 3002 } },
  modules: ['@wxt-dev/module-react'],
  // Sass has no notion of node resolution, so `@use "@learnos/ui/..."` means
  // nothing to it without a load path. pnpm links the workspace package in as
  // node_modules/@learnos/ui, and sass follows the symlink from there.
  vite: () => ({
    css: {
      preprocessorOptions: {
        scss: {
          loadPaths: [fileURLToPath(new URL('node_modules', import.meta.url))],
        },
      },
    },
  }),
  manifest: {
    name: 'Cold Recall',
    description: 'One retrieval question at a time. Never teaches — only helps you remember.',
    // storage: the token and T-028's per-day counters. alarms: the five-minute
    // "should I pop?" tick. idle: don't interrupt someone who isn't there.
    // notifications: how a card announces itself when the popup isn't open.
    // sidePanel: the card opens in a panel that stays put rather than a popup
    // that closes the moment the learner clicks anything (T-170).
    permissions: ['storage', 'alarms', 'notifications', 'idle', 'sidePanel'],
    // Without these Chrome shows the default puzzle piece in the toolbar — the
    // thing ten people are told to click — and `notifications.create` has no
    // icon to draw. A clay square with a paper dot; the same two colours the
    // web app is built from.
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    /**
     * An action with **no `default_popup`** (T-170). The toolbar button has to
     * exist for `openPanelOnActionClick` to have anything to hook onto, but the
     * moment it declares a popup Chrome opens that instead of the panel — and
     * WXT adds `default_popup` automatically for an entrypoint directory named
     * `popup`, which is why the card lives in `src/card/` now.
     */
    action: { default_title: 'Cold Recall' },
    /**
     * A fixed extension id (T-048, founder's call 2026-09-17).
     *
     * Chrome derives the id from this public key, so every install — every
     * laptop, every reload of the unpacked build — is
     * `chrome-extension://gijjgknkbkacdmlbloimmblgicondimf`. Without it the id
     * came from the directory the build sat in, which is why the API could not
     * allow the extension at all: `EXTENSION_ORIGINS` needs an id that does not
     * move, and in production an unlisted origin is refused (`app.ts`).
     *
     * **This is a public key and belongs in the repository.** It signs nothing;
     * it only names the extension. The private half was generated with it and
     * is needed only to pack a `.crx` by hand — it is not in this repo, and
     * nothing in the build reads it.
     *
     * If this extension is ever published to the Chrome Web Store, the store
     * issues its own id: drop this `key` and update `EXTENSION_ORIGINS` to
     * match, or the API will refuse the published build (`docs/deploy.md`).
     */
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAk3cfIOjJgDuHxrWI1gMmMMqVyMatvEBOZ/S0kgyk7fkWWucmWg7GtiRkfkpTJU0KogoFdB/xIi7Ye3p1VUg5VUTgkXPrMNp2mJB64VHXufnm7R3GfKuOJ2ePvD5crq+IhzV8ADBIuEUPUxP+Mc6eQFPUyVK+LnlAMt8U5anMrbtJmfCWmFRoQP8urPazhhaoaEFmxG+Qr1NZnxAKwo8h6aeOy7I09OPRuUpQcUbbP/tfqs43FOZjDMB/nySeC5xcvWSZFG+R2ov6FHdVT7sUxezW1QYxqRsszvpfv5aX9uOtpuf0OINRvDztwAVZVvdOBsMAQbUjPv4U3aDAqeZHowIDAQAB',
    // Exactly one origin, and no `<all_urls>`: this extension reads nothing
    // from the pages the learner is browsing, and asking for more would be
    // both a lie about what it does and a much worse review to pass.
    host_permissions: [`${new URL(API_URL).origin}/*`],
  },
});
