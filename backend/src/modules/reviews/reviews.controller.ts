import type { Request, Response } from 'express';
import { ReviewError } from '../../lib/recordReview.js';
import { userId } from '../../middleware/auth.js';
import { submitReview } from './reviews.service.js';

export async function postReview(req: Request, res: Response) {
  try {
    res.status(200).json(await submitReview(userId(req), req.body));
  } catch (error) {
    if (error instanceof ReviewError) {
      res.status(404).json({ error: error.reason });
      return;
    }
    throw error;
  }
}