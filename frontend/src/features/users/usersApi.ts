import { api } from '../../store/api';
import type { MeResponse, UserUpdate } from '@learnos/shared';

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
  }),
});

export const { useMeQuery, useUpdateMeMutation } = usersApi;
