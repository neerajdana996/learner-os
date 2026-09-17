import type { Request, Response } from 'express';
import type { PulseCreate } from '@learnos/shared';
import { userId } from '../../middleware/auth.js';
import { recordPulse } from './pulse.service.js';
import { PulseResponseSchema } from '@learnos/shared';
import { sendJson } from '../../lib/respond.js';

export async function postPulse(req: Request, res: Response) {
  sendJson(res, PulseResponseSchema, await recordPulse(userId(req), req.body as PulseCreate));
}
