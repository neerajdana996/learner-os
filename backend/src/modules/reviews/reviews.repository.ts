import { recordReview, type RecordReviewResult } from '../../lib/recordReview.js';
import type { Answer } from '@learnos/shared';

export function persistReview(userId: string, answer: Answer): Promise<RecordReviewResult> {
  return recordReview(userId, answer);
}