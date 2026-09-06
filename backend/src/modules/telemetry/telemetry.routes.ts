import { Router } from 'express';
import { TelemetrySchema } from '@learnos/shared';
import { validate } from '../../lib/validate.js';
import { requireUser } from '../../middleware/auth.js';
import { postTelemetry } from './telemetry.controller.js';

export const telemetryRouter = Router();

/**
 * Authenticated, because every row is attributed to a learner — the answer rate
 * is per person, and an unauthenticated firehose would be both unusable and an
 * open write endpoint.
 */
telemetryRouter.post('/telemetry', requireUser, validate(TelemetrySchema), postTelemetry);
