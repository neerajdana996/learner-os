import { Router } from 'express';
import { isProd } from '../../lib/env.js';
import { validate } from '../../lib/validate.js';
import { requireUser } from '../../middleware/auth.js';
import { DevLoginSchema, MagicLinkSchema, VerifyQuerySchema } from '../../shared/index.js';
import { getVerify, postDevLogin, postExtensionToken, postMagic } from './auth.controller.js';
import { limitMagicLink } from './auth.rateLimit.js';
import { getOAuthCallback, getOAuthStart } from './oauth.controller.js';

export const authRouter = Router();

// validate before limit: the email is normalised first, so casing and padding
// can't be used to spend a separate bucket per variant.
authRouter.post('/auth/magic', validate(MagicLinkSchema), limitMagicLink, postMagic);
authRouter.get('/auth/verify', validate(VerifyQuerySchema, 'query'), getVerify);
authRouter.post('/auth/extension-token', requireUser, postExtensionToken);

/**
 * Dev-only password sign-in (T-070), so a developer can get in without a mail
 * round trip or a provider redirect.
 *
 * **Not registered at all in production** — the route simply does not exist
 * there, which is a stronger guarantee than a handler that checks a flag, and
 * it means a misconfiguration cannot turn it back on. `x-user-id` is gated the
 * same way in `middleware/auth.ts`.
 */
if (!isProd) {
  // No rate limit, deliberately. `limitMagicLink` allows 3 per address per 15
  // minutes because /auth/magic mails a stranger on demand; this route mails
  // nothing, and that budget would lock a developer out after the third sign-in
  // of the afternoon — the exact friction this exists to remove. It would also
  // spend the shared bucket and start 429ing the real magic-link flow. On a
  // host where this route exists at all, `x-user-id` already grants any account
  // with no password, so a brute-force guard here protects nothing.
  authRouter.post('/auth/dev-login', validate(DevLoginSchema), postDevLogin);
}

// OAuth (T-055). No validate() — the shape is dictated by the provider's
// redirect, and the callback validates `code`/`state` itself.
authRouter.get('/auth/oauth/:provider/start', getOAuthStart);
authRouter.get('/auth/oauth/:provider/callback', getOAuthCallback);
