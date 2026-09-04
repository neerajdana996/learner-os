import { Router } from 'express';
import { validate } from '../lib/validate.js';
import { recordReview, ReviewError } from '../lib/recordReview.js';
import { requireUser, userId } from '../middleware/auth.js';
import { AnswerSchema, type Answer } from '../shared/index.js';

export const reviewsRouter = Router();

/**
 * Records one answer from any surface (web, extension, diagnostic, test).
 *
 * `correct` is currently taken from the client. T-011 adds server-side grading
 * and computes it from `response` instead, so a client can't mark its own
 * answer correct.
 */
reviewsRouter.post('/reviews', requireUser, validate(AnswerSchema), async (req, res) => {
  try {
    const result = await recordReview(userId(req), req.body as Answer);
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof ReviewError) {
      res.status(404).json({ error: error.reason });
      return;
    }
    throw error;
  }
});
