import { Router } from 'express';
import { validate } from '../../lib/validate.js';
import { requireUser } from '../../middleware/auth.js';
import { UserUpdateSchema } from '@learnos/shared';
import { getMeHandler, patchMeHandler } from './users.controller.js';

export const usersRouter = Router();

usersRouter.get('/me', requireUser, getMeHandler);
usersRouter.patch('/me', requireUser, validate(UserUpdateSchema), patchMeHandler);
