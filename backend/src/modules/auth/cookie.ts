/**
 * Its own module so `middleware/auth.ts` can read the cookie without importing
 * the auth controller, which imports the middleware back.
 */
export const SESSION_COOKIE = 'learnos_session';

/**
 * Minimal `Cookie:` header parser. Express 5 does not parse cookies and the
 * only one we read is our own opaque session token, so a dependency would buy
 * nothing here (CLAUDE.md: no new deps without a reason).
 */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}
