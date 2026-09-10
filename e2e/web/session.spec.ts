import { expect, test } from '@playwright/test';
import { answerCard, fingerprint, tapConfidence, writeFingerprint } from '../card.js';
import { fetchMap, firstTopicId, makeCardsDue, signIn } from '../api.js';
import { signInAsDev } from '../ui.js';

/**
 * A daily session, start to finish (T-021, T-073).
 *
 * The thing worth protecting is that the session **runs its due reviews**.
 * Before T-073 `GET /session` returned them and the screen counted them
 * without ever asking, so no retrieval happened between sessions at all — the
 * product was not running its own method, and every test in the suite passed
 * throughout. So this spec does not stop at the first card: it walks the new
 * concept, then asserts a review step actually arrives.
 */

/**
 * Answers whatever card is on screen and waits for the server's verdict.
 *
 * The confidence tap is not a formality: `Check` stays disabled until it is
 * given, and it is never pre-selected, so an untapped answer stays
 * distinguishable from a real one. That gate is asserted here rather than
 * merely satisfied — it is what makes the calibration number mean anything.
 */
async function answerAndCheck(page: import('@playwright/test').Page): Promise<void> {
  await answerCard(page);

  const check = page.getByRole('button', { name: /^check$/i });
  await expect(check).toBeDisabled();
  await tapConfidence(page);
  await expect(check).toBeEnabled();

  await check.click();
  await expect(page.getByRole('button', { name: /^next$/i })).toBeVisible({ timeout: 30_000 });
}

test('a session teaches, asks, grades — and then runs the due reviews', async ({ page, request }) => {
  await signIn(request);
  const due = await makeCardsDue(request, 5);
  expect(due).toBeGreaterThan(0);

  await signInAsDev(page);
  await page.getByRole('link', { name: /start today/i }).click();
  await expect(page).toHaveURL(/\/session/);

  // Wait for the session to render before branching on what it shows.
  // `count()` does not wait, and the first draft of this spec read it before
  // the fetch resolved — which is how a passing app produces a failing test.
  const tryFirst = page.getByText('Have a go first');
  const review = page.getByText('From an earlier day');
  await expect(tryFirst.or(review).first()).toBeVisible({ timeout: 45_000 });

  // ---- a new concept opens with an attempt, before any explanation (plan §3.5)
  if (await tryFirst.isVisible()) {
    await expect(page.getByText(/^New concept ·/)).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('01-try-first.png'), fullPage: true });

    await page.getByLabel('Your attempt').fill('the component never re-renders');
    await page.getByRole('button', { name: /show me/i }).click();

    await expect(page.getByText('How to hold it')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('02-explanation.png'), fullPage: true });

    // The retrieval that follows the teaching, on the same concept.
    const fp = await fingerprint(page, 'web session');
    expect(fp.prompt.length).toBeGreaterThan(0);
    expect(fp.answerKind).not.toBe('unknown');
    writeFingerprint(fp);
    await page.screenshot({ path: test.info().outputPath('03-card.png'), fullPage: true });

    await answerAndCheck(page);
    await page.screenshot({ path: test.info().outputPath('04-graded.png'), fullPage: true });
    await page.getByRole('button', { name: /^next$/i }).click();
  }

  // ---- the due reviews, which is the whole point of T-073
  await expect(review.first()).toBeVisible({ timeout: 45_000 });

  // A review carries no teaching and no chance to read it again first: the gap
  // is what makes it worth anything.
  await expect(page.getByText('How to hold it')).toHaveCount(0);
  // Waited for *before* the screenshot, not after: the retrieval card animates
  // in, and shooting on the step change caught an empty frame that looked
  // exactly like a rendering bug.
  await expect(page.locator('.question__prompt')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('05-review.png'), fullPage: true });

  // If the session fingerprint was not written above (a session that opened
  // straight onto a review), write it from here — T-137 needs one per run.
  const fp = await fingerprint(page, 'web session (review)');
  writeFingerprint(fp);

  await answerAndCheck(page);
  await page.screenshot({ path: test.info().outputPath('06-review-graded.png'), fullPage: true });
});

test('the map colours what is known and never names a held-out concept', async ({ page, request }) => {
  await signIn(request);
  const topicId = await firstTopicId(request);

  // ---- the contract, at the API (T-017, plan.md §6)
  const map = await fetchMap(request, topicId);
  const heldOut = map.concepts.filter((c) => c.state === 'heldout');
  expect(heldOut.length).toBeGreaterThan(0);
  // A learner who sees the title studies it, and that destroys the control
  // group the entire result rests on. So the title is null on the wire, not
  // merely hidden in the component.
  for (const concept of heldOut) expect(concept.title).toBeNull();

  // ---- and on the screen
  await signInAsDev(page);
  await page.goto('/map');
  await expect(page.getByText(/Held back ·/)).toBeVisible({ timeout: 30_000 });

  // Every held-out concept renders as a placeholder, and there are exactly as
  // many of those as the API withheld.
  await expect(page.getByText('Held back until day 30')).toHaveCount(heldOut.length);

  // No taught concept's title leaked into a held-back tile, and the score is
  // real rather than the "0 concepts so far" that could never move (T-064).
  expect(map.score).toBeGreaterThan(0);
  await expect(page.getByText(/Solid ·/)).toBeVisible();

  await page.screenshot({ path: test.info().outputPath('map.png'), fullPage: true });
});
