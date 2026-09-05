import { api } from '../../store/api';
import type { TopicCreate } from '../../shared';

export interface TopicSummary {
  id: string;
  title: string;
  why: string | null;
  status: 'generating' | 'active' | 'testing' | 'holdout' | 'done' | 'failed';
  error: string | null;
  startsAt: string | null;
  endsAt: string | null;
  counts: { concepts: number; items: number };
}

export const topicsApi = api.injectEndpoints({
  endpoints: (build) => ({
    topics: build.query<{ topics: TopicSummary[] }, void>({
      query: () => '/topics',
      providesTags: ['Topic'],
    }),
    topic: build.query<TopicSummary, string>({
      query: (id) => `/topics/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'Topic', id }],
    }),
    createTopic: build.mutation<{ topicId: string; status: string }, TopicCreate>({
      query: (body) => ({ url: '/topics', method: 'POST', body }),
      invalidatesTags: ['Topic'],
    }),
  }),
});

export const { useTopicsQuery, useTopicQuery, useCreateTopicMutation } = topicsApi;

/**
 * Generation takes minutes, so onboarding polls. Poll only while the job is
 * actually running: `skipPollingIfUnfocused` stops the interval on a
 * backgrounded tab, and returning 0 once the topic is terminal stops it for
 * good rather than hammering the API for the rest of the session.
 */
export function generationPollInterval(status: TopicSummary['status'] | undefined): number {
  return status === 'generating' ? 3000 : 0;
}
