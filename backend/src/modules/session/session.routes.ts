import { Router } from 'express';
import { validate } from '../../lib/validate.js';
import { requireUser } from '../../middleware/auth.js';
import { SessionCompleteSchema } from '../../shared/index.js';
import { getSessionHandler, postCompleteHandler } from './session.controller.js';

export const sessionRouter = Router();

sessionRouter.get('/session', requireUser, getSessionHandler);
sessionRouter.post('/session/complete', requireUser, validate(SessionCompleteSchema), postCompleteHandler);
