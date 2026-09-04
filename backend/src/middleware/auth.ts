import type { NextFunction, Request, RequestHandler, Response } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/**
 * Interim auth. plan.md §5: "magic link (email); `x-user-id` header is a dev
 * shortcut only." T-013 replaces the body of this function with cookie-backed
 * sessions — routes keep calling `requireUser` unchanged.
 *
 * TODO(T-013): reject `x-user-id` when NODE_ENV=production. Deliberately NOT
 * done yet: compose runs the backend with NODE_ENV=production, and until magic
 * links exist this header is the only way to authenticate, so rejecting it now
 * would break the Sprint 1 demo (`curl -X POST /topics`) that T-012 verifies
 * against compose. The guard lands together with its replacement.
 */
export const requireUser: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const header = req.get('x-user-id');
  if (!header) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  req.userId = header;
  next();
};

/** Narrows `req.userId` for handlers mounted behind `requireUser`. */
export function userId(req: Request): string {
  const id = req.userId;
  if (!id) throw new Error('requireUser middleware did not run for this route');
  return id;
}
