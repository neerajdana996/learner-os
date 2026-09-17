import type { Request, Response } from 'express';
import type { Telemetry } from '@learnos/shared';
import { userId } from '../../middleware/auth.js';
import { recordEvents } from './telemetry.service.js';
import { TelemetryResponseSchema } from '@learnos/shared';
import { sendJson } from '../../lib/respond.js';

export async function postTelemetry(req: Request, res: Response) {
  sendJson(res, TelemetryResponseSchema, await recordEvents(userId(req), req.body as Telemetry));
}
