import type { Request, Response } from 'express';
import { userId } from '../../middleware/auth.js';
import { answerQuestion, DiagnosticError, nextQuestion, startDiagnostic } from './diagnostic.service.js';
import { DiagnosticNextResponseSchema } from '@learnos/shared';
import { sendJson } from '../../lib/respond.js';

function handle(res: Response, error: unknown): void {
  if (error instanceof DiagnosticError) {
    res.status(error.reason === 'topic_not_found' ? 404 : 400).json({ error: error.reason });
    return;
  }
  throw error;
}

export async function postStart(req: Request, res: Response) {
  const { topicId } = req.params as { topicId: string };
  try {
    sendJson(res, DiagnosticNextResponseSchema, await startDiagnostic(userId(req), topicId));
  } catch (error) {
    handle(res, error);
  }
}

export async function getNext(req: Request, res: Response) {
  const { topicId } = req.params as { topicId: string };
  try {
    sendJson(res, DiagnosticNextResponseSchema, await nextQuestion(userId(req), topicId));
  } catch (error) {
    handle(res, error);
  }
}

export async function postAnswer(req: Request, res: Response) {
  const { topicId } = req.params as { topicId: string };
  try {
    sendJson(res, DiagnosticNextResponseSchema, await answerQuestion(userId(req), topicId, req.body));
  } catch (error) {
    handle(res, error);
  }
}
