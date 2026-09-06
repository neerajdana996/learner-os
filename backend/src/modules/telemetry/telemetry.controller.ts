import type { Request, Response } from 'express';
import type { Telemetry } from '@learnos/shared';
import { userId } from '../../middleware/auth.js';
import { recordEvents } from './telemetry.service.js';

export async function postTelemetry(req: Request, res: Response) {
  res.status(200).json(await recordEvents(userId(req), req.body as Telemetry));
}
