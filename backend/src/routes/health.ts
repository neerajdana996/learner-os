import { Router } from 'express';

export const healthRouter = Router();

/** Liveness. Compose healthchecks and the Sprint-1 exit criteria hit this. */
healthRouter.get('/health', (_req, res) => {
  res.json({ ok: true });
});
