/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const devProxyTarget = loadEnv(mode, '.', '').VITE_DEV_PROXY_TARGET ?? 'http://localhost:3001';

  return {
    plugins: [react()],
    build: {
      // Vendor code changes far less often than app code. Splitting it keeps the
      // big, stable dependencies in chunks a returning learner already has cached
      // instead of re-downloading them on every deploy.
      rollupOptions: {
        output: {
          // Matched on resolved paths, not bare specifiers: RTK Query is imported
          // as '@reduxjs/toolkit/query/react', and a specifier list misses that
          // subpath entirely, leaving ~50kB of it in the entry chunk.
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return 'react';
            if (/[\\/]node_modules[\\/](@reduxjs|react-redux|redux|redux-thunk|immer|reselect)[\\/]/.test(id)) return 'redux';
            // Everything else — notably zod, which only the screens doing shared
            // client-side validation import as a value — is left to Rollup, so it
            // rides the chunk that needs it instead of loading on the login page.
            return undefined;
          },
        },
      },
      // The app is small; a low warning limit surfaces accidental bloat early.
      chunkSizeWarningLimit: 250,
    },
    server: {
      port: 5173,
      // Dev: same-origin `/api` → backend, mirroring nginx.conf in production.
      proxy: {
        '/api': { target: devProxyTarget, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
        '/ws': { target: devProxyTarget.replace(/^http/, 'ws'), ws: true },
      },
    },
    test: {
      // happy-dom, not jsdom: jsdom ships its own AbortController/AbortSignal that
      // fail Node's native (undici) fetch's `instanceof` checks, which breaks RTK
      // Query's fetchBaseQuery (it builds a Request with an internal abort signal
      // even when fetch itself is mocked).
      environment: 'happy-dom',
      globals: true,
      setupFiles: ['./vitest.setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
    },
  };
});
