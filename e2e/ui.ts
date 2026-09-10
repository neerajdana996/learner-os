import { expect, type Page } from '@playwright/test';

/**
 * The one place a selector for a shared control lives.
 *
 * The first draft of these specs guessed "Dev sign-in" and four tests failed
 * on the same wrong string. A control that appears in every spec belongs in a
 * helper: when the button is renamed, one line changes rather than four, and
 * the failure names the control instead of the page.
 */

/** The dev sign-in button (T-070). Its label carries the account, which is the
 *  point — you can see which learner you are about to become. */
export const DEV_SIGN_IN = /sign in as dev@learnos\.local/i;

/**
 * Signs in and waits for the route guard to place the learner.
 *
 * The session is an httpOnly cookie the app never reads, so where this lands
 * is decided server-side: onboarding for a learner with no topic, the
 * dashboard for one who has. The seeded learner has a topic.
 */
export async function signInAsDev(page: Page): Promise<void> {
  await page.goto('/signin');
  await page.getByRole('button', { name: DEV_SIGN_IN }).click();
  await expect(page).toHaveURL(/\/home/, { timeout: 45_000 });
}
