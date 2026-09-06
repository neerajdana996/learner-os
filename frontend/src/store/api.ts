import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

/**
 * The one RTK Query API for the web app (loop.md §2). Every backend call is an
 * endpoint, and components use the generated hooks — never `fetch` directly.
 *
 * This file stays small and endpoint-free on purpose: each feature injects its
 * own endpoints from `features/<name>/<name>Api.ts`, so a feature's data layer
 * lives beside its screens and can be code-split with them.
 */
export const api = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({
    baseUrl: import.meta.env.VITE_API_URL ?? '/api',
    // The magic-link/OAuth session is an httpOnly cookie, so it rides along on
    // its own and there is no token for JS to hold (T-013, T-055).
    credentials: 'include',
    prepareHeaders: (headers) => {
      // Dev-only escape hatch so `pnpm seed`'s user can be driven without a mail
      // round trip. The backend rejects this header under NODE_ENV=production.
      const devUser = import.meta.env.VITE_DEV_USER_ID;
      if (devUser && import.meta.env.DEV) headers.set('x-user-id', devUser);
      return headers;
    },
  }),
  tagTypes: ['Me', 'Topic', 'Map', 'Session', 'Due', 'Diagnostic'],
  // Declared empty; features add to it. `overrideExisting` stays false so a
  // duplicate endpoint name is a loud dev-time warning rather than a silent
  // replacement.
  endpoints: () => ({}),
});
