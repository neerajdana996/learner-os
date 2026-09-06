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
    name: 'learnos',
    description: 'One retrieval question at a time. Never teaches — only helps you remember.',
    // storage: the token and T-028's per-day counters. alarms: the five-minute
    // "should I pop?" tick. idle: don't interrupt someone who isn't there.
    // notifications: how a card announces itself when the popup isn't open.
    permissions: ['storage', 'alarms', 'notifications', 'idle'],
    // Exactly one origin, and no `<all_urls>`: this extension reads nothing
    // from the pages the learner is browsing, and asking for more would be
    // both a lie about what it does and a much worse review to pass.
    host_permissions: [`${new URL(API_URL).origin}/*`],
  },
});
