/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Dev: same-origin `/api` → backend, mirroring nginx.conf in production.
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
      '/ws': { target: 'ws://localhost:3001', ws: true },
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
});
