import type { Answer } from '@learnos/shared';
import { persistReview } from './reviews.repository.js';

export function submitReview(userId: string, answer: Answer) {
  return persistReview(userId, answer);
}