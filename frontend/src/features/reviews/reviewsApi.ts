import { api } from '../../store/api';
import type { Answer } from '@learnos/shared';

export interface ReviewResult {
  eventId: string;
  conceptId: string;
  correct: boolean | null;
  feedback: string | null;
  scheduled: boolean;
  reps: number;
}

export const reviewsApi = api.injectEndpoints({
  endpoints: (build) => ({
    /**
     * The client never sends `correct` — it cannot grade, because the answer key
     * never leaves the server (T-010/T-011). It sends the response and renders
     * whatever verdict comes back.
     */
    submitReview: build.mutation<ReviewResult, Answer>({
      query: (body) => ({ url: '/reviews', method: 'POST', body }),
      invalidatesTags: ['Map', 'Due'],
    }),
  }),
});

export const { useSubmitReviewMutation } = reviewsApi;
