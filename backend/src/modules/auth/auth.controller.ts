import type { Request, Response } from 'express';
import { env, isProd } from '../../lib/env.js';
import { userId } from '../../middleware/auth.js';
import { readCookie, SESSION_COOKIE } from './cookie.js';
import { createSession, devLogin, endSession, requestMagicLink, verifyMagicLink } from './auth.service.js';

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

/**
 * Dev-only (T-070). The route is not registered under NODE_ENV=production, so
 * in production this is a 404 — not a 401, because the endpoint genuinely does
 * not exist there.
 */
export async function postDevLogin(req: Request, res: Response) {
  const { email, password } = req.body as { email: string; password: string };
  const session = await devLogin(email, password);

  if (!session) {
    res.status(401).json({ error: 'invalid_credentials' });
    return;
  }

  res.cookie(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    expires: session.expiresAt,
  });
  res.status(200).json({ ok: true });
}

/**
 * Sign out (T-080). Answers 200 whether or not there was a live session: the
 * caller wants to end up signed out, and a 401 here would leave a stale cookie
 * in the browser with nothing the UI could do about it.
 */
export async function postLogout(req: Request, res: Response) {
  const raw = readCookie(req.get('cookie'), SESSION_COOKIE);
  if (raw) await endSession(raw);

  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: isProd, path: '/' });
  res.status(200).json({ ok: true });
}

export async function postExtensionToken(req: Request, res: Response) {
  const session = await createSession(userId(req), 'extension');
  res.status(201).json({ token: session.token, expiresAt: session.expiresAt.toISOString() });
}
