import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { env, isProd } from './lib/env.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { diagnosticRouter } from './modules/diagnostic/diagnostic.routes.js';
import { sessionRouter } from './modules/session/session.routes.js';
import { mapRouter } from './modules/map/map.routes.js';
import { topicsRouter } from './modules/topics/topics.routes.js';
import { reviewsRouter } from './modules/reviews/reviews.routes.js';
import { dueRouter } from './modules/due/due.routes.js';

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
  app.use(authRouter);
  app.use(usersRouter);
  app.use(diagnosticRouter);
  app.use(sessionRouter);
  // Ahead of topicsRouter so /topics/:id/map isn't shadowed by /topics/:id.
  app.use(mapRouter);
  app.use(topicsRouter);
  app.use(reviewsRouter);
  app.use(dueRouter);

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
