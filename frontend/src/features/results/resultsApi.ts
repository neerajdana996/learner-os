import type { ResultsResponse } from '@learnos/shared';
import { api } from '../../store/api';

export const resultsApi = api.injectEndpoints({
  endpoints: (build) => ({
    results: build.query<ResultsResponse, string>({
      query: (topicId) => `/topics/${topicId}/results`,
      providesTags: (_r, _e, id) => [{ type: 'Topic', id }],
    }),
  }),
});

export const { useResultsQuery } = resultsApi;
