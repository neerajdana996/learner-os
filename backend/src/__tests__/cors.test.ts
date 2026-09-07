import { describe, expect, it } from 'vitest';
import { allowOrigin } from '../app.js';
import { env } from '../lib/env.js';

/** Calls the middleware's origin callback synchronously. */
function allows(origin: string | undefined): boolean {
  let result = false;
  allowOrigin(origin, (_err, allow) => {
    result = allow === true;
  });
  return result;
}

describe('which origins may call the API (T-122)', () => {
  it('allows the configured web app', () => {
    expect(allows(env.CORS_ORIGINS[0])).toBe(true);
  });

  it('allows an unpacked extension outside production', () => {
    // An unpacked build's id comes from its directory, so it differs on every
    // machine and cannot be committed. Without this the options page's request
    // is blocked by the browser and the extension reports the backend as down
    // while the backend is answering perfectly.
    expect(allows('chrome-extension://abcdefghijklmnopabcdefghijklmnop')).toBe(true);
  });

  it('allows a request with no origin, which is not a browser', () => {
    // curl, pnpm seed, and every example in docs/api.md. CORS is a browser
    // mechanism; refusing these protects nothing.
    expect(allows(undefined)).toBe(true);
  });

  it('refuses an unrelated site', () => {
    expect(allows('https://evil.example.com')).toBe(false);
  });

  it('refuses a site merely prefixed with an allowed origin', () => {
    // `http://localhost:3000.evil.com` must not pass on a startsWith check.
    expect(allows('http://localhost:3000.evil.com')).toBe(false);
  });
});
