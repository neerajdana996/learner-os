import { Router } from 'express';
import { validate } from '../../lib/validate.js';
import { requireUser } from '../../middleware/auth.js';
import { MagicLinkSchema, VerifyQuerySchema } from '../../shared/index.js';
import { getVerify, postExtensionToken, postMagic } from './auth.controller.js';

export const authRouter = Router();

authRouter.post('/auth/magic', validate(MagicLinkSchema), postMagic);
authRouter.get('/auth/verify', validate(VerifyQuerySchema, 'query'), getVerify);
authRouter.post('/auth/extension-token', requireUser, postExtensionToken);
