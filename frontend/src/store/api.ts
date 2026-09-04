import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { HealthResponse } from '../shared';

/**
 * The ONE RTK Query API for the web app (loop.md §2). Every backend call is an
 * endpoint here; components use the generated hooks and never call fetch.
 *
 * Later tasks inject endpoints with `api.injectEndpoints(...)` from feature
 * files (e.g. `features/topics/topicsApi.ts`) so this file stays small.
 */
export const api = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({
    baseUrl: import.meta.env.VITE_API_URL ?? '/api',
    credentials: 'include',
    prepareHeaders: (headers) => {
      // TODO(T-013): magic-link session token. Dev shortcut only:
      const devUser = import.meta.env.VITE_DEV_USER_ID;
      if (devUser) headers.set('x-user-id', devUser);
      return headers;
    },
  }),
  tagTypes: ['Topic', 'Map', 'Session', 'Due', 'User'],
  endpoints: (build) => ({
    health: build.query<HealthResponse, void>({ query: () => '/health' }),
  }),
});

export const { useHealthQuery } = api;
