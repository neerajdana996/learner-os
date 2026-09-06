import type { Request, Response } from 'express';
import type { PulseCreate } from '@learnos/shared';
import { userId } from '../../middleware/auth.js';
import { recordPulse } from './pulse.service.js';

export async function postPulse(req: Request, res: Response) {
  res.status(200).json(await recordPulse(userId(req), req.body as PulseCreate));
}
