import { api } from '../../store/api';
import type { SessionResponse } from '@learnos/shared';

export const sessionApi = api.injectEndpoints({
  endpoints: (build) => ({
    session: build.query<SessionResponse, void>({
      query: () => '/session',
      providesTags: ['Session'],
    }),
    completeSession: build.mutation<{ completedToday: true; taught: number }, string[]>({
      query: (conceptIds) => ({ url: '/session/complete', method: 'POST', body: { conceptIds } }),
      // Teaching creates cards and moves mastery, so the map and the due queue
      // are both stale now.
      invalidatesTags: ['Session', 'Map', 'Due'],
    }),
  }),
});

export const { useSessionQuery, useCompleteSessionMutation } = sessionApi;
