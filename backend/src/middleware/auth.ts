import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { isProd } from '../lib/env.js';
import { readCookie, SESSION_COOKIE } from '../modules/auth/cookie.js';
import { resolveSession } from '../modules/auth/auth.service.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

function bearer(req: Request): string | null {
  const header = req.get('authorization');
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : null;
}

/**
 * Resolves the caller from a session (plan.md §5: magic link; `x-user-id` is a
 * dev shortcut only).
 *
 * Two credential shapes, one `sessions` table: the web app sends an httpOnly
 * cookie, the extension sends `Authorization: Bearer` because a cross-origin
 * MV3 service worker cannot rely on cookies.
 *
 * `x-user-id` still works outside production so `docs/api.md`'s curl examples
 * and `pnpm seed` stay usable without a mail round trip. It is rejected under
 * `NODE_ENV=production`, which is what sprint.md's Sprint 2 exit criteria
 * require and what T-008 deferred to this task.
 */
export const requireUser: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  const raw = readCookie(req.get('cookie'), SESSION_COOKIE) ?? bearer(req);

  if (raw) {
    const resolved = await resolveSession(raw);
    if (!resolved) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    req.userId = resolved;
    next();
    return;
  }

  const devHeader = req.get('x-user-id');
  if (devHeader && !isProd) {
    req.userId = devHeader;
    next();
    return;
  }

  res.status(401).json({ error: 'unauthorized' });
};

/** Narrows `req.userId` for handlers mounted behind `requireUser`. */
export function userId(req: Request): string {
  const id = req.userId;
  if (!id) throw new Error('requireUser middleware did not run for this route');
  return id;
}
