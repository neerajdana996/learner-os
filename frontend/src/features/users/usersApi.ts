import { api } from '../../store/api';
import type { DeleteMe, DeleteMeResponse, MeExport, MeResponse, UserUpdate } from '@learnos/shared';

export const usersApi = api.injectEndpoints({
  endpoints: (build) => ({
    me: build.query<MeResponse, void>({
      query: () => '/me',
      providesTags: ['Me'],
    }),
    updateMe: build.mutation<MeResponse, UserUpdate>({
      query: (body) => ({ url: '/me', method: 'PATCH', body }),
      // The response *is* the new profile, so write it straight into the cache
      // instead of invalidating and paying for a second round trip.
      onQueryStarted: async (_arg, { dispatch, queryFulfilled }) => {
        const { data } = await queryFulfilled;
        dispatch(usersApi.util.upsertQueryData('me', undefined, data));
      },
    }),
    /**
     * Everything held about the learner (T-046). Not cached: it is fetched on a
     * click to be saved as a file, and a cached copy would hand back yesterday's
     * data to someone asking for what is held today.
     */
    exportMe: build.query<MeExport, void>({
      query: () => '/me/export',
      keepUnusedDataFor: 0,
    }),
    /** Deletes the account (T-046). The caller resets the whole API state after,
     *  since every cached query now describes a person who does not exist. */
    deleteMe: build.mutation<DeleteMeResponse, DeleteMe>({
      query: (body) => ({ url: '/me', method: 'DELETE', body }),
    }),
  }),
});

export const { useMeQuery, useUpdateMeMutation, useLazyExportMeQuery, useDeleteMeMutation } = usersApi;
