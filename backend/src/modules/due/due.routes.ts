import { Router } from 'express';
import { validate } from '../../lib/validate.js';
import { requireUser } from '../../middleware/auth.js';
import { DueQuerySchema } from '../../shared/index.js';
import { getDue } from './due.controller.js';

export const dueRouter = Router();

dueRouter.get('/due', requireUser, validate(DueQuerySchema, 'query'), getDue);