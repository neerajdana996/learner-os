import { Router } from 'express';
import { PulseCreateSchema } from '@learnos/shared';
import { validate } from '../../lib/validate.js';
import { requireUser } from '../../middleware/auth.js';
import { postPulse } from './pulse.controller.js';

export const pulseRouter = Router();

/** The day comes from the client because only the client knows the learner's
 *  local date — a card answered at 11pm in Kolkata is already tomorrow in UTC,
 *  and "once a day" has to mean their day. */
pulseRouter.post('/pulse', requireUser, validate(PulseCreateSchema), postPulse);
