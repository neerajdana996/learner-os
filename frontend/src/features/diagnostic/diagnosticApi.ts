import { api } from '../../store/api';
import type { DiagnosticAnswer, DiagnosticNextResponse } from '../../shared';

/**
 * The diagnostic is a server-driven walk: the client never decides what comes
 * next, it just renders whatever `next` returns and posts an answer back.
 *
 * Answering returns the *next* question, so the mutation's response replaces
 * the cached `next` directly — one round trip per question instead of
 * answer-then-refetch, which matters when a learner is working through fifteen
 * of them.
 */
export const diagnosticApi = api.injectEndpoints({
  endpoints: (build) => ({
    diagnosticNext: build.query<DiagnosticNextResponse, string>({
      query: (topicId) => `/diagnostic/${topicId}/next`,
      providesTags: (_r, _e, topicId) => [{ type: 'Diagnostic', id: topicId }],
    }),
    startDiagnostic: build.mutation<DiagnosticNextResponse, string>({
      query: (topicId) => ({ url: `/diagnostic/${topicId}/start`, method: 'POST' }),
      onQueryStarted: async (topicId, { dispatch, queryFulfilled }) => {
        const { data } = await queryFulfilled;
        dispatch(diagnosticApi.util.upsertQueryData('diagnosticNext', topicId, data));
      },
    }),
    answerDiagnostic: build.mutation<
      DiagnosticNextResponse,
      { topicId: string; answer: DiagnosticAnswer }
    >({
      query: ({ topicId, answer }) => ({
        url: `/diagnostic/${topicId}/answer`,
        method: 'POST',
        body: answer,
      }),
      onQueryStarted: async ({ topicId }, { dispatch, queryFulfilled }) => {
        const { data } = await queryFulfilled;
        dispatch(diagnosticApi.util.upsertQueryData('diagnosticNext', topicId, data));
      },
      // Finishing seeds cards and a day-0 score, so the map is now stale.
      invalidatesTags: (result) => (result?.done ? ['Map', 'Due'] : []),
    }),
  }),
});

export const { useDiagnosticNextQuery, useStartDiagnosticMutation, useAnswerDiagnosticMutation } =
  diagnosticApi;
