import type { Request, Response } from 'express';
import { userId } from '../../middleware/auth.js';
import { getDueItems } from './due.service.js';

export async function getDue(req: Request, res: Response) {
  const { limit } = req.query as unknown as { limit: number };
  res.json(await getDueItems(userId(req), limit));
}