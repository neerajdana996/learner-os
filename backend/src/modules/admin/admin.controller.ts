import type { Request, Response } from 'express';
import { buildReport, reviewsCsv } from './admin.service.js';

export async function getMetrics(_req: Request, res: Response) {
  res.json(await buildReport());
}

export async function getReviewsCsv(req: Request, res: Response) {
  const topicId = req.params.id as string;
  const csv = await reviewsCsv(topicId);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  // `attachment` rather than inline: a CSV rendered in the browser is unusable,
  // and the filename is what makes three exports distinguishable in a downloads
  // folder a week later.
  res.setHeader('Content-Disposition', `attachment; filename="reviews-${topicId}.csv"`);
  res.send(csv);
}
