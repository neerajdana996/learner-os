import { api } from '../../store/api';
import type { Answer, ReviewResult } from '@learnos/shared';

/** From `@learnos/shared`, the schema the server checks it against (T-075). */
export type { ReviewResult };

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
