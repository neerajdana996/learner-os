import { Router } from 'express';
import { validate } from '../../lib/validate.js';
import { requireUser } from '../../middleware/auth.js';
import { DiagnosticAnswerSchema } from '@learnos/shared';
import { getNext, postAnswer, postStart } from './diagnostic.controller.js';

export const diagnosticRouter = Router();

diagnosticRouter.post('/diagnostic/:topicId/start', requireUser, postStart);
diagnosticRouter.get('/diagnostic/:topicId/next', requireUser, getNext);
diagnosticRouter.post(
  '/diagnostic/:topicId/answer',
  requireUser,
  validate(DiagnosticAnswerSchema),
  postAnswer,
);
