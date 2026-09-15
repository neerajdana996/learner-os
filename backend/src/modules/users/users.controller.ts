import type { Request, Response } from 'express';
import type { DeleteMe } from '@learnos/shared';
import { isProd } from '../../lib/env.js';
import { userId } from '../../middleware/auth.js';
import { SESSION_COOKIE } from '../auth/cookie.js';
import { deleteMe, EmailMismatchError, exportMe, getMe, patchMe, UserNotFoundError } from './users.service.js';

export async function getMeHandler(req: Request, res: Response) {
  try {
    res.json(await getMe(userId(req)));
  } catch (error) {
    if (error instanceof UserNotFoundError) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    throw error;
  }
}

export async function patchMeHandler(req: Request, res: Response) {
  try {
    res.json(await patchMe(userId(req), req.body));
  } catch (error) {
    if (error instanceof UserNotFoundError) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    throw error;
  }
}

/** `GET /me/export` (T-046). Sent as an attachment so opening the URL directly
 *  saves a file rather than rendering a wall of JSON. */
export async function exportMeHandler(req: Request, res: Response) {
  try {
    const data = await exportMe(userId(req));
    res.setHeader('Content-Disposition', 'attachment; filename="cold-recall-data.json"');
    res.json(data);
  } catch (error) {
    if (error instanceof UserNotFoundError) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    throw error;
  }
}

/**
 * `DELETE /me` (T-046). Clears the session cookie on the way out, the same way
 * `/auth/logout` does: the row it pointed at no longer exists, and a stale
 * cookie would leave the browser holding a credential for nobody.
 */
export async function deleteMeHandler(req: Request, res: Response) {
  try {
    await deleteMe(userId(req), (req.body as DeleteMe).confirmEmail);
  } catch (error) {
    if (error instanceof EmailMismatchError) {
      res.status(400).json({ error: 'email_mismatch' });
      return;
    }
    if (error instanceof UserNotFoundError) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    throw error;
  }

  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: isProd, path: '/' });
  res.status(200).json({ deleted: true });
}
