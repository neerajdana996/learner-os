import type { TestAvailability, TestNext, TestScores, TestSubmit } from '@learnos/shared';
import { api } from '../../store/api';

export const testsApi = api.injectEndpoints({
  endpoints: (build) => ({
    coldTest: build.query<TestNext, string>({
      query: (id) => `/tests/${id}/next`,
      providesTags: (_result, _error, id) => [{ type: 'Test', id }],
    }),
    topicTest: build.query<TestAvailability, string>({
      query: (id) => `/topics/${id}/tests`,
      providesTags: ['Test'],
    }),
    answerColdTest: build.mutation<TestNext, { id: string; answer: TestSubmit }>({
      query: ({ id, answer }) => ({ url: `/tests/${id}/answer`, method: 'POST', body: answer }),
      async onQueryStarted({ id }, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          await dispatch(testsApi.util.upsertQueryData('coldTest', id, data));
        } catch { /* Keep the existing question and draft available for a retry. */ }
      },
    }),
    completeColdTest: build.mutation<TestScores, string>({
      query: (id) => ({ url: `/tests/${id}/complete`, method: 'POST' }),
      invalidatesTags: ['Test', 'Topic', 'Session'],
    }),
  }),
});
export const { useColdTestQuery, useTopicTestQuery, useAnswerColdTestMutation, useCompleteColdTestMutation } = testsApi;
