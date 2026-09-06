import type { Request, Response } from 'express';
import { userId } from '../../middleware/auth.js';
import { getDueItems } from './due.service.js';

/**
 * `/due` is the extension's queue and only the extension's — the web session
 * calls `getDueItems` directly. So the surface is pinned here rather than read
 * from a header a client could get wrong (T-089).
 */
export async function getDue(req: Request, res: Response) {
  const { limit } = req.query as unknown as { limit: number };
  res.json(await getDueItems(userId(req), limit, new Date(), 'extension'));
}