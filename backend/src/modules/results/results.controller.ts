import type { Request, Response } from 'express';
import { userId } from '../../middleware/auth.js';
import { resultsFor, ResultsError } from './results.service.js';
import { ResultsResponseSchema } from '@learnos/shared';
import { sendJson } from '../../lib/respond.js';

export async function getResults(req: Request, res: Response) {
  try {
    sendJson(res, ResultsResponseSchema, await resultsFor(userId(req), req.params.id as string));
  } catch (error) {
    if (error instanceof ResultsError) {
      // 404 rather than 403 for someone else's topic: a 403 would confirm the
      // topic exists, which is more than a stranger should learn from a guess.
      res.status(404).json({ error: error.reason });
      return;
    }
    throw error;
  }
}
