import { expect, type APIRequestContext } from '@playwright/test';
import { API } from './api.js';

/**
 * Auth-specific helpers (E2E-001).
 *
 * Split from `api.ts` because these exist only to drive the rate limiter and
 * the magic-link lifecycle — nothing else in the suite needs them, and they
 * carry assumptions (a fresh email per call) that would be a footgun if mixed
 * into the general-purpose helpers.
 */

/** A fresh address per call. The per-email rate limiter (3 / 15 min) is
 *  in-memory on the backend process and never reset between test files —
 *  `webServer.reuseExistingServer` means the same process serves the whole
 *  run — so a shared literal address would make one test's rate-limit check
 *  poison every other test that happens to request a link afterward. */
export function freshEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

export async function requestMagicLink(
  request: APIRequestContext,
  email: string,
): Promise<{ status: number; body: unknown }> {
  const res = await request.post(`${API}/auth/magic`, { data: { email } });
  return { status: res.status(), body: await res.json().catch(() => null) };
}

/** `POST /auth/magic` must answer identically for a registered and an
 *  unregistered address — the whole point is that it cannot be used to
 *  discover who has an account (T-013). Call with both and diff the result. */
export async function assertMagicLinkIsNotAnOracle(
  request: APIRequestContext,
  registeredEmail: string,
  unregisteredEmail: string,
): Promise<void> {
  const known = await requestMagicLink(request, registeredEmail);
  const unknown = await requestMagicLink(request, unregisteredEmail);
  expect(known.status).toBe(unknown.status);
  expect(known.body).toEqual(unknown.body);
}
