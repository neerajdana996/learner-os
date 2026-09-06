import { Router } from 'express';
import { validate } from '../../lib/validate.js';
import { requireUser } from '../../middleware/auth.js';
import { IdParamSchema, TopicCreateSchema } from '@learnos/shared';
import { getTopic, getTopics, postTopic } from './topics.controller.js';

export const topicsRouter = Router();

topicsRouter.post('/topics', requireUser, validate(TopicCreateSchema), postTopic);
topicsRouter.get('/topics', requireUser, getTopics);
topicsRouter.get('/topics/:id', requireUser, validate(IdParamSchema, 'params'), getTopic);