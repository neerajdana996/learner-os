import type { Request, Response } from 'express';
import { flagItem, ItemError } from './items.service.js';

export async function postFlag(req: Request, res: Response) {
  try {
    res.json(await flagItem(req.params.id as string));
  } catch (error) {
    if (error instanceof ItemError) {
      res.status(404).json({ error: error.reason });
      return;
    }
    throw error;
  }
}
