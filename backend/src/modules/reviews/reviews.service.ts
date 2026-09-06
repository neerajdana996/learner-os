import type { Answer } from '../../shared/index.js';
import { persistReview } from './reviews.repository.js';

export function submitReview(userId: string, answer: Answer) {
  return persistReview(userId, answer);
}