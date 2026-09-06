import { createHash, randomBytes } from 'node:crypto';

/**
 * Opaque bearer secrets for magic links and sessions (T-013).
 *
 * Only the SHA-256 hash is ever stored. A leaked database dump then contains
 * no usable login link and no usable session — the raw value exists only in
 * the learner's email and their cookie.
 *
 * Lookup is by hash against a unique index rather than by comparing candidates
 * in application code, so there is no per-character comparison to time. The
 * 256 bits of entropy is what makes guessing infeasible; the hash is what makes
 * a dump useless.
 */
export interface IssuedToken {
  /** Sent to the client. Never persisted. */
  raw: string;
  /** Persisted. Never sent. */
  hash: string;
}

export function issueToken(): IssuedToken {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
