import { expect, test } from '@playwright/test';
import { DEV_SIGN_IN, signInAsDev } from '../ui.js';

/**
 * A stranger arrives, reads the pitch, and signs in (T-101, T-071).
 *
 * The regression this protects is specific: `/` used to be the sign-in form,
 * so someone following a recruitment link was asked for their address before
 * being told what this is. If `/` ever renders a form again, this fails.
 */
test('the landing page comes first, then the sign-in form', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Learn it once');
  // The form is not on this page. `getByLabel` rather than a class, because
  // what matters is that nothing is *asking* for an address yet.
  await expect(page.getByRole('textbox', { name: /email/i })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('01-landing.png'), fullPage: true });

  await page.getByRole('link', { name: /take a place|take one of the ten places|sign in/i }).first().click();
  await expect(page).toHaveURL(/\/signin/);
  await expect(page.getByRole('button', { name: DEV_SIGN_IN })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('02-signin.png') });
});

test('the dev sign-in lands on a dashboard with a session to do', async ({ page }) => {
  await signInAsDev(page);
  await expect(page.getByRole('link', { name: /start today/i })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('03-dashboard.png'), fullPage: true });
});

test.describe('the magic link', () => {
  test('a request is not an account-existence oracle', async ({ request }) => {
    const { assertMagicLinkIsNotAnOracle, freshEmail } = await import('../auth.js');
    // 'dev@learnos.local' is registered (the seeded learner); the other is not.
    await assertMagicLinkIsNotAnOracle(request, 'dev@learnos.local', freshEmail());
  });

  test('the UI shows "check your inbox" without leaking whether the address exists', async ({ page }) => {
    const { freshEmail } = await import('../auth.js');
    await page.goto('/signin');
    await page.getByLabel(/email/i).fill(freshEmail());
    await page.getByRole('button', { name: /email me a link/i }).click();

    await expect(page.getByRole('heading', { name: /check your inbox/i })).toBeVisible({ timeout: 15_000 });
    // The copy names the address back (per LoginPage.tsx's isSuccess branch)
    // but must not claim or deny the account exists.
    await expect(page.getByText(/if .* is on the pilot list/i)).toBeVisible();
  });

  test('a malformed address never reaches the server', async ({ page }) => {
    await page.goto('/signin');
    const button = page.getByRole('button', { name: /email me a link/i });

    // Empty — the button starts disabled per LoginPage.tsx's onSubmit guard.
    await expect(button).toBeDisabled();

    // Not a valid email shape. The native `type="email"` input plus the
    // trimmed/lowercased server schema both reject this, but the point of this
    // test is that the *client* never fires the request at all.
    let requested = false;
    await page.route('**/api/auth/magic', (route) => {
      requested = true;
      route.continue();
    });
    await page.getByLabel(/email/i).fill('not-an-email');
    // The button may or may not be disabled here depending on how strictly
    // LoginPage validates client-side — either way, submitting must not
    // reach the network with an invalid address.
    if (await button.isEnabled()) {
      await button.click();
      await page.waitForTimeout(500);
    }
    expect(requested).toBe(false);
  });

  test('the 4th request in 15 minutes for one address is refused', async ({ request }) => {
    const { freshEmail, requestMagicLink } = await import('../auth.js');
    const email = freshEmail();

    // PER_EMAIL = 3 (auth.rateLimit.ts). The first three succeed with the same
    // 200 the oracle test already confirmed; the fourth is rate limited.
    for (let i = 0; i < 3; i += 1) {
      const res = await requestMagicLink(request, email);
      expect(res.status).toBe(200);
    }
    const fourth = await requestMagicLink(request, email);
    expect(fourth.status).toBe(429);
  });

  test('the UI surfaces a rate-limited request as a generic retry error', async ({ page, request }) => {
    const { freshEmail, requestMagicLink } = await import('../auth.js');
    const email = freshEmail();
    // Exhaust the limit via the API first — faster and more reliable than
    // clicking the button 4 times, and this test's job is the UI's reaction,
    // not re-proving the limiter.
    for (let i = 0; i < 3; i += 1) await requestMagicLink(request, email);

    await page.goto('/signin');
    await page.getByLabel(/email/i).fill(email);
    await page.getByRole('button', { name: /email me a link/i }).click();

    // LoginPage.tsx renders one generic error for any RTK Query error — it
    // does not distinguish a 429 from a network failure. Assert that actual
    // behavior rather than a rate-limit-specific message that doesn't exist.
    await expect(page.getByText(/didn.t go through/i)).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('session routing', () => {
  test('a signed-in visitor to "/" is forwarded past the landing page', async ({ page }) => {
    await signInAsDev(page);
    await page.goto('/');
    // The inverse of the signed-out case above (T-071's own regression target):
    // a learner mid-course must never be shown the pitch again.
    await expect(page).toHaveURL(/\/home/, { timeout: 15_000 });
  });

  // KNOWN GAP (T-141, filed 2026-09-10): unlike "/", "/signin" has no guard
  // against an already-signed-in visitor — it just renders the form again.
  // This asserts *today's* actual behavior so the suite stays honest; flip
  // this to expect a redirect once T-141 ships, and delete this comment.
  test('a signed-in visitor to "/signin" still sees the form (T-141)', async ({ page }) => {
    await signInAsDev(page);
    await page.goto('/signin');
    await expect(page).toHaveURL(/\/signin/);
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  });

  test('an expired session on a protected route bounces to /signin, not /', async ({ page, context }) => {
    await signInAsDev(page);
    // Simulate expiry without waiting for real TTL: drop the session cookie
    // client-side, which is indistinguishable from the server having expired
    // it — RequireAuth reacts to a failed `/me`, not to cookie presence.
    await context.clearCookies();
    await page.goto('/session');
    // Per RequireAuth.tsx's own comment: to the form, not to `/` — someone
    // whose cookie expired mid-session has already read the pitch.
    await expect(page).toHaveURL(/\/signin/, { timeout: 15_000 });
  });

  test('logout actually clears the session', async ({ page, request }) => {
    await signInAsDev(page);
    const logout = await request.post('http://localhost:3001/auth/logout');
    expect(logout.ok()).toBe(true);

    const me = await request.get('http://localhost:3001/me');
    expect(me.status()).toBe(401);
  });
});
