import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { env, isProd } from './lib/env.js';
import { healthRouter } from './routes/health.js';

/**
 * Builds the Express app without binding a port, so tests can mount it with
 * supertest and `index.ts` can attach the HTTP + WebSocket servers.
 *
 * Route modules are registered here (loop.md §4: "If the task adds a route:
 * it's in backend/src/index.ts" — app.ts is where index.ts delegates to).
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  app.use(healthRouter);
  // TODO(T-008): topicsRouter
  // TODO(T-009): reviewsRouter
  // TODO(T-010): dueRouter

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'unknown';
    if (!isProd) console.error(err);
    res.status(500).json({ error: 'internal', message: isProd ? undefined : message });
  });

  return app;
}
