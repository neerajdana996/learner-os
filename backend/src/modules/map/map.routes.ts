import { Router } from 'express';
import { validate } from '../../lib/validate.js';
import { requireUser } from '../../middleware/auth.js';
import { IdParamSchema } from '../../shared/index.js';
import { getMapHandler } from './map.controller.js';

export const mapRouter = Router();

mapRouter.get('/topics/:id/map', requireUser, validate(IdParamSchema, 'params'), getMapHandler);
