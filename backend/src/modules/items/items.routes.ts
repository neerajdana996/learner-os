import { Router } from 'express';
import { IdParamSchema } from '@learnos/shared';
import { validate } from '../../lib/validate.js';
import { requireUser } from '../../middleware/auth.js';
import { postFlag } from './items.controller.js';

export const itemsRouter = Router();

/**
 * Authenticated, though the report is not attributed to anyone: the count is
 * what retires a question, and who complained is not used. Requiring a session
 * keeps it from being an unauthenticated write that anyone could drive to three.
 */
itemsRouter.post('/items/:id/flag', requireUser, validate(IdParamSchema, 'params'), postFlag);
