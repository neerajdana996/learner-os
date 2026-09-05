import type { Request, Response } from 'express';
import { env, isProd } from '../../lib/env.js';
import { userId } from '../../middleware/auth.js';
import { SESSION_COOKIE } from './cookie.js';
import { createSession, requestMagicLink, verifyMagicLink } from './auth.service.js';

export async function postMagic(req: Request, res: Response) {
  const { email } = req.body as { email: string };
  await requestMagicLink(email);
  // Identical for a known and an unknown address, on purpose: any difference
  // here — status, body, or timing-visible work — would leak who has an account.
  res.status(200).json({ ok: true });
}

export async function getVerify(req: Request, res: Response) {
  const { token } = req.query as unknown as { token: string };
  const session = await verifyMagicLink(token);

  if (!session) {
    res.status(401).json({ error: 'invalid_token' });
    return;
  }

  res.cookie(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    expires: session.expiresAt,
  });
  res.redirect(env.APP_URL);
}

export async function postExtensionToken(req: Request, res: Response) {
  const session = await createSession(userId(req), 'extension');
  res.status(201).json({ token: session.token, expiresAt: session.expiresAt.toISOString() });
}
