import { Router } from 'express';
import { validate } from '../../lib/validate.js';
import { requireUser } from '../../middleware/auth.js';
import { MagicLinkSchema, VerifyQuerySchema } from '../../shared/index.js';
import { getVerify, postExtensionToken, postMagic } from './auth.controller.js';
import { limitMagicLink } from './auth.rateLimit.js';

export const authRouter = Router();

// validate before limit: the email is normalised first, so casing and padding
// can't be used to spend a separate bucket per variant.
authRouter.post('/auth/magic', validate(MagicLinkSchema), limitMagicLink, postMagic);
authRouter.get('/auth/verify', validate(VerifyQuerySchema, 'query'), getVerify);
authRouter.post('/auth/extension-token', requireUser, postExtensionToken);
