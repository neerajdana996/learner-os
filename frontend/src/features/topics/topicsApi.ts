import { api } from '../../store/api';
import type {
  GenerationProgress,
  TopicCreate,
  TopicCreateResponse,
  TopicListResponse,
  TopicSummary,
} from '@learnos/shared';

/**
 * Response shapes come from `@learnos/shared`, never from this file (T-075).
 * `TopicSummary` used to be declared here by hand, claiming nine fields while
 * the list sent four, and the dashboard told every learner it was their final
 * day (T-072). The server now checks what it sends against the same schema.
 */
export type { GenerationProgress, TopicSummary };

export const topicsApi = api.injectEndpoints({
  endpoints: (build) => ({
    topics: build.query<TopicListResponse, void>({
      query: () => '/topics',
      providesTags: ['Topic'],
    }),
    topic: build.query<TopicSummary, string>({
      query: (id) => `/topics/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'Topic', id }],
    }),
    createTopic: build.mutation<TopicCreateResponse, TopicCreate>({
      query: (body) => ({ url: '/topics', method: 'POST', body }),
      invalidatesTags: ['Topic'],
    }),
  }),
});

export const { useTopicsQuery, useTopicQuery, useCreateTopicMutation } = topicsApi;

/** Fast enough that a quick failure feels instant, for as long as one is
 *  plausible. */
export const FAST_POLL_MS = 3000;
export const FAST_POLL_WINDOW_MS = 30_000;
/** Generation runs five to ten minutes; after the first half-minute, three
 *  seconds is 100+ requests buying nothing (T-066). */
export const SLOW_POLL_MS = 15_000;

/**
 * Generation takes minutes, so onboarding polls. Poll only while the job is
 * actually running: `skipPollingIfUnfocused` stops the interval on a
 * backgrounded tab, and returning 0 once the topic is terminal stops it for
 * good rather than hammering the API for the rest of the session.
 *
 * Pure — it takes elapsed time rather than reading a clock — so the whole
 * schedule is unit-testable without rendering anything.
 */
export function generationPollInterval(
  status: TopicSummary['status'] | undefined,
  elapsedMs = 0,
): number {
  if (status !== 'generating') return 0;
  return elapsedMs < FAST_POLL_WINDOW_MS ? FAST_POLL_MS : SLOW_POLL_MS;
}

/** What the wait screen says it is doing. The counter it replaces could only
 *  ever read 0 until the final transaction landed (T-064). */
export function generationProgressLabel(progress: GenerationProgress | null | undefined): string {
  if (!progress) return 'Starting up…';
  switch (progress.stage) {
    case 'map':
      return 'Working out the concepts…';
    case 'saving':
      return 'Saving your map…';
    case 'content':
      return progress.completed === 0
        ? `Writing questions for ${progress.total} concepts…`
        : `${progress.completed} of ${progress.total} concepts written`;
  }
}
