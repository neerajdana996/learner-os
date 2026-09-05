import type { Request, Response } from 'express';
import { userId } from '../../middleware/auth.js';
import { completeSession, getSession, SessionError } from './session.service.js';

function handle(res: Response, error: unknown): void {
  if (error instanceof SessionError) {
    // no_active_topic is a 404 (nothing to work on yet); not_offered is a 400
    // (a real request for something the plan did not include).
    res.status(error.reason === 'no_active_topic' ? 404 : 400).json({ error: error.reason });
    return;
  }
  throw error;
}

export async function getSessionHandler(req: Request, res: Response) {
  try {
    res.json(await getSession(userId(req)));
  } catch (error) {
    handle(res, error);
  }
}

export async function postCompleteHandler(req: Request, res: Response) {
  const { conceptIds } = req.body as { conceptIds: string[] };
  console.log('conceptIds',conceptIds)
  try {
    res.json(await completeSession(userId(req), conceptIds));
  } catch (error) {
    handle(res, error);
  }
}
