import { Router } from 'express';
import { isProd } from '../../lib/env.js';
import { validate } from '../../lib/validate.js';
import { requireUser, userId } from '../../middleware/auth.js';
import { resetUser } from '../../lib/reset.js';
import { DevResetSchema } from '@learnos/shared';

export const devRouter = Router();

/**
 * Development conveniences (T-079). **Not registered under
 * `NODE_ENV=production`** — the same lock as `/auth/dev-login`, and a stronger
 * guarantee than a handler that checks a flag, because a misconfigured
 * environment cannot switch it back on.
 *
 * `POST /dev/reset` clears the caller's own work so a flow can be walked again
 * without re-generating a topic. It only ever touches the signed-in user's
 * rows, so even in development it cannot wipe someone else's course.
 */
if (!isProd) {
  devRouter.post('/dev/reset', requireUser, validate(DevResetSchema), async (req, res) => {
    const { scope } = req.body as { scope: 'progress' | 'topics' };
    res.json(await resetUser(userId(req), scope));
  });
}
