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
import { devRouter } from './modules/dev/dev.routes.js';
import { testsRouter } from './modules/tests/tests.routes.js';
import { itemsRouter } from './modules/items/items.routes.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { resultsRouter } from './modules/results/results.routes.js';
import { pulseRouter } from './modules/pulse/pulse.routes.js';
import { telemetryRouter } from './modules/telemetry/telemetry.routes.js';

/**
 * Builds the Express app without binding a port, so tests can mount it with
 * supertest and `index.ts` can attach the HTTP + WebSocket servers.
 *
 * Route modules are registered here (loop.md §4: "If the task adds a route:
 * it's in backend/src/index.ts" — app.ts is where index.ts delegates to).
 */
/**
 * Which origins may call this API (T-122).
 *
 * The web app is a fixed list. **The extension is not**: an unpacked build's id
 * comes from its directory, so it differs on every machine and cannot be
 * committed — and without an allowance the options page's request is blocked by
 * the browser and the extension reports "Could not reach the backend", which
 * reads as the server being down when it is answering perfectly.
 *
 * Outside production any `chrome-extension://` origin is allowed, so a freshly
 * loaded build connects with no configuration. Under `NODE_ENV=production` the
 * ids must be named in `EXTENSION_ORIGINS`: "any extension the learner happens
 * to have installed" is not an access policy.
 *
 * A missing origin (curl, same-origin, a server-side call) is allowed — CORS is
 * a browser mechanism and blocking those would break `pnpm seed` and every
 * example in `docs/api.md` without protecting anything.
 */
export function allowOrigin(
  origin: string | undefined,
  done: (err: Error | null, allow?: boolean) => void,
): void {
  if (!origin) return done(null, true);
  if (env.CORS_ORIGINS.includes(origin)) return done(null, true);

  if (origin.startsWith('chrome-extension://')) {
    return done(null, !isProd || env.EXTENSION_ORIGINS.includes(origin));
  }
  return done(null, false);
}

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: allowOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  app.use(healthRouter);
  app.use(authRouter);
  app.use(usersRouter);
  app.use(diagnosticRouter);
  app.use(sessionRouter);
  // Ahead of topicsRouter so /topics/:id/map isn't shadowed by /topics/:id.
  app.use(mapRouter);
  // Ahead of topicsRouter so /topics/:id/results isn't shadowed by /topics/:id.
  app.use(resultsRouter);
  app.use(testsRouter);
  app.use(topicsRouter);
  app.use(reviewsRouter);
  app.use(itemsRouter);
  app.use(adminRouter);
  app.use(pulseRouter);
  app.use(telemetryRouter);
  app.use(dueRouter);
  // Empty in production: the router registers no routes when isProd.
  app.use(devRouter);

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
