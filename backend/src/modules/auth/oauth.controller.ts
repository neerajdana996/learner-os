import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { env, isProd } from '../../lib/env.js';
import { readCookie, SESSION_COOKIE } from './cookie.js';
import { getProvider, OAuthError } from './oauth.providers.js';
import { signInWithProvider } from './oauth.service.js';

const STATE_COOKIE = 'learnos_oauth_state';

/** Express 5 types params as string | string[]; a single :provider segment is
 *  always a string, but narrow it rather than casting blindly. */
function providerParam(req: Request): string {
  const value = req.params.provider;
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function fail(res: Response, error: unknown): void {
  console.log(error)
  if (error instanceof OAuthError) {
    const status = error.reason === 'unknown_provider' || error.reason === 'not_configured' ? 404 : 400;
    res.status(status).json({ error: error.reason, message: error.message });
    return;
  }
  throw error;
}

/**
 * Starts the flow. The `state` is stored in a short-lived httpOnly cookie and
 * compared on the way back: without it, an attacker can hand a victim a
 * callback URL carrying the attacker's authorization code and silently log the
 * victim into the attacker's account.
 */
export function getOAuthStart(req: Request, res: Response) {
  try {
    const provider = getProvider(providerParam(req));
    const state = randomBytes(32).toString('base64url');

    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      path: '/',
      maxAge: 10 * 60_000,
    });
    res.redirect(provider.authorizeUrl(state));
  } catch (error) {
    fail(res, error);
  }
}

export async function getOAuthCallback(req: Request, res: Response) {
  try {
    const provider = getProvider(providerParam(req));
    const { code, state } = req.query as { code?: string; state?: string };
    const expected = readCookie(req.get('cookie'), STATE_COOKIE);

    res.clearCookie(STATE_COOKIE, { path: '/' });

    if (!code) throw new OAuthError('exchange_failed', 'no authorization code returned');
    if (!state || !expected || state !== expected) {
      throw new OAuthError('bad_state', 'state did not match — restart the sign-in');
    }

    const identity = await provider.exchange(code);
    const session = await signInWithProvider(provider.name, identity);

    res.cookie(SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      path: '/',
      expires: session.expiresAt,
    });
    res.redirect(env.APP_URL);
  } catch (error) {
    fail(res, error);
  }
}
