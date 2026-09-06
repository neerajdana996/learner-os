import { Router } from 'express';
import { validate } from '../../lib/validate.js';
import { requireUser } from '../../middleware/auth.js';
import { AnswerSchema } from '@learnos/shared';
import { postReview } from './reviews.controller.js';

export const reviewsRouter = Router();

reviewsRouter.post('/reviews', requireUser, validate(AnswerSchema), postReview);