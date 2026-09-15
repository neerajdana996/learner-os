import { Router } from 'express';
import { validate } from '../../lib/validate.js';
import { requireUser } from '../../middleware/auth.js';
import { DeleteMeSchema, UserUpdateSchema } from '@learnos/shared';
import { deleteMeHandler, exportMeHandler, getMeHandler, patchMeHandler } from './users.controller.js';

export const usersRouter = Router();

usersRouter.get('/me', requireUser, getMeHandler);
usersRouter.patch('/me', requireUser, validate(UserUpdateSchema), patchMeHandler);
// T-046: the learner's own copy, and the learner's own deletion.
usersRouter.get('/me/export', requireUser, exportMeHandler);
usersRouter.delete('/me', requireUser, validate(DeleteMeSchema), deleteMeHandler);
