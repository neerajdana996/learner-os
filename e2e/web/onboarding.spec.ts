import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { API, firstTopicId, signIn } from '../api.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Every test in `submitting` below actually clicks "Build my map", leaving a
 * real topic behind for the fresh user. Playwright runs this file's tests
 * sequentially in one worker, so without re-seeding, the second such test
 * would find the *first* test's topic already there — and T-144's own
 * recovery effect would adopt it and skip straight to the wait screen,
 * making every selector past `/onboarding` time out for reasons that have
 * nothing to do with what that test is actually checking.
 */
function reseedFreshUser(): void {
  execFileSync('pnpm', ['--filter', 'learner-os-backend', 'seed:fresh'], { cwd: ROOT, stdio: 'ignore' });
}

/**
 * Onboarding, the five steps (E2E-002).
 *
 * Runs against a genuinely fresh, topic-less user (`e2e/fresh-user.json`,
 * written by `pnpm --filter learner-os-backend seed:fresh` in global-setup),
 * never against the shared `dev@learnos.local` — destructively resetting that
 * account's topics here would break every other spec file in this project
 * that assumes it already has a taught topic, since Playwright runs this
 * project's files in one worker, sequentially (`playwright.config.ts`'s own
 * `workers: 1`).
 */

interface FreshUser {
  userId: string;
  webSessionToken: string;
}

function loadFreshUser(): FreshUser {
  const path = fileURLToPath(new URL('../fresh-user.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as FreshUser;
}

async function signInFresh(page: Page): Promise<void> {
  const user = loadFreshUser();
  await page.context().addCookies([
    { name: 'learnos_session', value: user.webSessionToken, domain: 'localhost', path: '/', httpOnly: true },
  ]);
}

test.describe('a brand-new learner', () => {
  test('lands on /onboarding, not /home', async ({ page }) => {
    await signInFresh(page);
    await page.goto('/');
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /who.?s learning/i })).toBeVisible();
  });
});

test.describe('the five steps', () => {
  test('Continue is gated correctly at each step, and the stepper advances', async ({ page }) => {
    await signInFresh(page);
    await page.goto('/onboarding');

    // ---- step 0: name optional, role required
    await expect(page.getByText('STEP 1 OF 5')).toBeVisible();
    const continueBtn = page.getByRole('button', { name: 'Continue' });
    await expect(continueBtn).toBeDisabled();
    await page.getByText('I build products or apps', { exact: true }).click();
    await expect(continueBtn).toBeEnabled();
    await continueBtn.click();

    // ---- step 1: topic required (pilot card or free text — E2E-002 covers
    // the gate itself; T-149's free-text specifics live in OnboardingPage's
    // own unit tests)
    await expect(page.getByText('STEP 2 OF 5')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await page.getByText('Sliding window', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();
    await page.getByRole('button', { name: 'Continue' }).click();

    // ---- step 2: budget always has a default, never disabled
    await expect(page.getByText('STEP 3 OF 5')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();
    await page.getByRole('button', { name: 'Continue' }).click();

    // ---- step 3: windows, valid by default (two non-overlapping windows)
    await expect(page.getByText('STEP 4 OF 5')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();
    await page.getByRole('button', { name: 'Continue' }).click();

    // ---- step 4: the confirmation screen
    await expect(page.getByText('STEP 5 OF 5')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Build my map' })).toBeEnabled();
  });

  test('an overlapping window is rejected inline, and Continue disables', async ({ page }) => {
    await signInFresh(page);
    await page.goto('/onboarding');
    await page.getByText('I build products or apps', { exact: true }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByText('Sliding window', { exact: true }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByText('STEP 4 OF 5')).toBeVisible();
    // Default windows are 09:00-12:00 and 14:00-18:00. Overlap the second
    // into the first — `ActiveWindowsSchema`'s own overlap rule (T-054),
    // enforced client-side with the identical schema the API validates with.
    const untilFields = page.locator('input[type="time"]');
    await untilFields.nth(3).fill('10:00'); // second window's start -> 10:00, inside the first
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await expect(page.getByRole('alert')).toBeVisible();
  });

  test('a window ending before it starts is rejected inline', async ({ page }) => {
    await signInFresh(page);
    await page.goto('/onboarding');
    await page.getByText('I’m studying', { exact: true }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByText('Dynamic programming', { exact: true }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByText('STEP 4 OF 5')).toBeVisible();
    const timeFields = page.locator('input[type="time"]');
    // First window's "Until" set before its own "From" (09:00).
    await timeFields.nth(1).fill('08:00');
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  test('a fourth window cannot be added', async ({ page }) => {
    await signInFresh(page);
    await page.goto('/onboarding');
    await page.getByText('Something else', { exact: true }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByText('Consistency in distributed systems', { exact: true }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByText('STEP 4 OF 5')).toBeVisible();
    // Two windows exist by default; add one more to reach the cap of 3.
    await page.getByRole('button', { name: 'Add another window' }).click();
    await expect(page.getByRole('button', { name: 'Add another window' })).toHaveCount(0);
  });
});

test.describe('submitting', () => {
  test.beforeEach(reseedFreshUser);

  test('POST /topics fires once, and the wait screen renders', async ({ page }) => {
    await signInFresh(page);
    await page.goto('/onboarding');
    await page.getByText('I build products or apps', { exact: true }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByText('Sliding window', { exact: true }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    let posts = 0;
    await page.route('**/api/topics', (route) => {
      if (route.request().method() === 'POST') posts += 1;
      route.continue();
    });

    await page.getByRole('button', { name: 'Build my map' }).click();

    await expect(page.getByText('Building your map')).toBeVisible({ timeout: 15_000 });
    expect(posts).toBe(1);
  });

  test('double-clicking "Build my map" does not create two topics', async ({ page, request }) => {
    await signInFresh(page);
    await page.goto('/onboarding');
    await page.getByText('I’m studying', { exact: true }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByText('Dynamic programming', { exact: true }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    // Two rapid clicks — the button has no client-side debounce of its own;
    // the dedup guarantee this test is for is server-side (T-065).
    const build = page.getByRole('button', { name: 'Build my map' });
    await Promise.all([build.click(), build.click()]);

    await expect(page.getByText('Building your map')).toBeVisible({ timeout: 15_000 });

    const user = loadFreshUser();
    const res = await request.get(`${API}/topics`, {
      headers: { Cookie: `learnos_session=${user.webSessionToken}` },
    });
    const body = (await res.json()) as { topics: unknown[] };
    expect(body.topics).toHaveLength(1);
  });

  test('a topic stuck generating shows the wait screen, not an error, on reload', async ({ page }) => {
    // Today's actual behavior (T-069 is still `todo`) — this is a loose
    // assertion on purpose, so it doesn't break the moment T-069 ships a
    // real timeout/stuck-job UI.
    await signInFresh(page);
    await page.goto('/onboarding');
    await page.getByText('I build products or apps', { exact: true }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByText('Sliding window', { exact: true }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Build my map' }).click();
    await expect(page.getByText('Building your map')).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await expect(page.getByText('Building your map')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/error|failed/i)).toHaveCount(0);
  });
});

test.describe('re-entry', () => {
  test('a learner with an existing topic cannot see the onboarding form again', async ({ page, request }) => {
    // Reuses the already-active seeded dev topic — a genuinely different
    // account from the fresh-user tests above, and the one place this spec
    // deliberately does touch `dev@learnos.local`: read-only, via the
    // already-signed-in dev button, never resetting anything on it.
    await page.goto('/signin');
    await page.getByRole('button', { name: /sign in as dev@learnos\.local/i }).click();
    await expect(page).toHaveURL(/\/home/, { timeout: 30_000 });

    // `page` and `request` do not share a cookie jar in this project's config
    // (see session.spec.ts) — the dev-login above only authenticated `page`.
    await signIn(request);
    const topicId = await firstTopicId(request);
    void topicId; // confirms a topic really exists for this account before asserting the guard

    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/home/, { timeout: 15_000 });
  });
});
