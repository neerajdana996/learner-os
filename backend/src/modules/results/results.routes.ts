import { Router } from 'express';
import { IdParamSchema } from '@learnos/shared';
import { validate } from '../../lib/validate.js';
import { requireUser } from '../../middleware/auth.js';
import { getResults } from './results.controller.js';

export const resultsRouter = Router();

resultsRouter.get(
  '/topics/:id/results',
  requireUser,
  validate(IdParamSchema, 'params'),
  getResults,
);
