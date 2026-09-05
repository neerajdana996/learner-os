import type { NextFunction, Request, Response } from 'express';
import { createRateLimiter } from '../../lib/rateLimit.js';

const WINDOW_MS = 15 * 60_000;
/** One address should not need more than a few links in 15 minutes. */
const PER_EMAIL = 3;
/**
 * Higher than the per-email limit because a household, office or mobile
 * carrier NAT legitimately shares one address across several learners — this
 * catches a script working through a list, not a second person signing up.
 */
const PER_IP = 20;

export const emailLimiter = createRateLimiter(PER_EMAIL, WINDOW_MS);
export const ipLimiter = createRateLimiter(PER_IP, WINDOW_MS);

/** Test seam — suites share one process, so counters carry between them. */
export function resetAuthRateLimits(): void {
  emailLimiter.reset();
  ipLimiter.reset();
}

/**
 * Throttles `POST /auth/magic`, which is unauthenticated and, since the SMTP
 * transport landed, actually sends mail to whatever address it is handed. It
 * both creates a user row on first sight and mails a stranger, so unthrottled
 * it is a mailbox-flooding tool aimed at any address the caller chooses.
 *
 * Runs after `validate(MagicLinkSchema)` so the email is already normalised and
 * `Mixed@Example.com ` cannot be spent as a separate bucket from `mixed@example.com`.
 */
export function limitMagicLink(req: Request, res: Response, next: NextFunction): void {
  const { email } = req.body as { email: string };
  const ip = req.ip ?? 'unknown';

  if (!emailLimiter.check(`email:${email}`) || !ipLimiter.check(`ip:${ip}`)) {
    // No token row, no mail. The body says nothing about which limit was hit,
    // and 429 is returned for an unknown address too, so this stays consistent
    // with /auth/magic not being an account-existence oracle.
    res.status(429).json({ error: 'rate_limited' });
    return;
  }
  next();
}
