import type { Request, Response } from 'express';
import { userId } from '../../middleware/auth.js';
import { getMap, MapError } from './map.service.js';
import { MapResponseSchema } from '@learnos/shared';
import { sendJson } from '../../lib/respond.js';

export async function getMapHandler(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  try {
    sendJson(res, MapResponseSchema, await getMap(userId(req), id));
  } catch (error) {
    if (error instanceof MapError) {
      res.status(404).json({ error: error.reason });
      return;
    }
    throw error;
  }
}
