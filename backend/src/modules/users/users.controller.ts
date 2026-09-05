import type { Request, Response } from 'express';
import { userId } from '../../middleware/auth.js';
import { getMe, patchMe, UserNotFoundError } from './users.service.js';

export async function getMeHandler(req: Request, res: Response) {
  try {
    res.json(await getMe(userId(req)));
  } catch (error) {
    if (error instanceof UserNotFoundError) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    throw error;
  }
}

export async function patchMeHandler(req: Request, res: Response) {
  try {
    res.json(await patchMe(userId(req), req.body));
  } catch (error) {
    if (error instanceof UserNotFoundError) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    throw error;
  }
}
