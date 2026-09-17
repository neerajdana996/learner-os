import type { Request, Response } from 'express';
import { flagItem, getSkeleton, ItemError } from './items.service.js';
import { ItemFlagResponseSchema, SkeletonResponseSchema } from '@learnos/shared';
import { sendJson } from '../../lib/respond.js';

export async function postFlag(req: Request, res: Response) {
  try {
    sendJson(res, ItemFlagResponseSchema, await flagItem(req.params.id as string));
  } catch (error) {
    if (error instanceof ItemError) {
      res.status(404).json({ error: error.reason });
      return;
    }
    throw error;
  }
}

export async function getItemSkeleton(req: Request, res: Response) {
  try {
    sendJson(res, SkeletonResponseSchema, await getSkeleton(req.params.id as string));
  } catch (error) {
    if (error instanceof ItemError) {
      res.status(404).json({ error: error.reason });
      return;
    }
    throw error;
  }
}
