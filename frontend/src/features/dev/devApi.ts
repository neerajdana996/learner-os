import { api } from '../../store/api';
import type { DevReset } from '@learnos/shared';

export interface ResetSummary {
  topics: { title: string; concepts: number }[];
  reviewEvents: number;
  cards: number;
}

/**
 * Dev-only (T-079). The backend does not register `/dev/*` under
 * NODE_ENV=production, so these are 404 there — and every caller sits behind
 * `import.meta.env.DEV`, which drops them from the production bundle entirely.
 *
 * Invalidates everything: a reset changes the topic list, the map, the session
 * and `hasExtensionToken`, so hand-picking tags here would leave a stale screen
 * behind the one thing whose whole purpose is a clean slate.
 */
export const devApi = api.injectEndpoints({
  endpoints: (build) => ({
    devReset: build.mutation<ResetSummary, DevReset>({
      query: (body) => ({ url: '/dev/reset', method: 'POST', body }),
      invalidatesTags: ['Me', 'Topic', 'Map', 'Session', 'Due', 'Diagnostic'],
    }),
  }),
});

export const { useDevResetMutation } = devApi;
