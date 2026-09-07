import { Router } from 'express';
import { IdParamSchema } from '@learnos/shared';
import { validate } from '../../lib/validate.js';
import { requireUser } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/admin.js';
import { getMetrics, getReviewsCsv } from './admin.controller.js';

export const adminRouter = Router();

/**
 * `requireUser` then `requireAdmin`, in that order and never merged: 401 and
 * 403 are different answers to different questions, and collapsing them would
 * tell a signed-out founder they are not allowed rather than not signed in.
 */
adminRouter.get('/admin/metrics', requireUser, requireAdmin, getMetrics);

adminRouter.get(
  '/admin/topics/:id/reviews.csv',
  requireUser,
  requireAdmin,
  validate(IdParamSchema, 'params'),
  getReviewsCsv,
);
