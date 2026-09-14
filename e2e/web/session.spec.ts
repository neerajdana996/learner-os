import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { answerCard, fingerprint, tapConfidence, writeFingerprint } from '../card.js';
import { API, makeCardsDue, signIn } from '../api.js';
import { signInAsDev } from '../ui.js';

/**
 * Clicks past whatever step is currently on screen — "I don't know" first if
 * the try-first prompt hasn't been revealed yet, then "Skip this one" — to
 * reach a step further down the queue without answering everything ahead of
 * it for real. Works for both a concept and a review step, since a review is
 * already revealed and only needs the second click.
 */
async function skipCurrentStep(page: Page): Promise<void> {
  const dontKnow = page.getByRole('button', { name: /i.?don.t know/i });
  if (await dontKnow.isVisible().catch(() => false)) {
    await dontKnow.click();
  }
  await page.getByRole('button', { name: /skip this one/i }).click();
}

interface SessionFixture {
  userId: string;
  webSessionToken: string;
  topicId: string;
}

function loadSessionFixtures(): { empty: SessionFixture; withWork: SessionFixture; manyReady: SessionFixture } {
  const path = fileURLToPath(new URL('../session-users.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as {
    empty: SessionFixture;
    withWork: SessionFixture;
    manyReady: SessionFixture;
  };
}

async function signInAsFixture(page: Page, fixture: SessionFixture): Promise<void> {
  await page.context().addCookies([
    { name: 'learnos_session', value: fixture.webSessionToken, domain: 'localhost', path: '/', httpOnly: true },
  ]);
}

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
  // `example_first` is the third way a session can open, and these specs
  // assumed it could not happen. `pnpm seed` alternates the two teach modes, so
  // whether the next new concept opens with an attempt or straight with the
  // explanation depends on which concept is next — and on a run where that was
  // an `example_first` concept, neither label below ever appears. The tests
  // failed while the product worked correctly.
  const exampleFirst = page.getByText('How to hold it');
  await expect(tryFirst.or(exampleFirst).or(review).first()).toBeVisible({ timeout: 45_000 });

  const onNewConcept = await tryFirst.or(exampleFirst).first().isVisible();

  // ---- a try_first concept opens with an attempt, before any explanation
  //      (plan §3.5). An example_first one opens with the explanation, which
  //      is the same design decision seen from its other side.
  if (await tryFirst.isVisible()) {
    await expect(page.getByText(/^New concept ·/)).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('01-try-first.png'), fullPage: true });

    await page.getByLabel('Your attempt').fill('the component never re-renders');
    await page.getByRole('button', { name: /show me/i }).click();

    await expect(page.getByText('How to hold it')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('02-explanation.png'), fullPage: true });
  }

  // ---- the retrieval that follows the teaching, on the same concept —
  //      reached by answering the try-first prompt, or immediately on an
  //      example_first concept.
  if (onNewConcept) {
    await expect(page.getByText(/^New concept ·/)).toBeVisible();
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

test('a session never offers more than 3 new concepts, even with many more ready', async ({ request }) => {
  const { manyReady } = loadSessionFixtures();
  const res = await request.get(`${API}/session`, {
    headers: { Cookie: `learnos_session=${manyReady.webSessionToken}` },
  });
  const body = (await res.json()) as { newConcepts: unknown[] };
  // `seedSessionUsers.ts`'s `manyReady` fixture leaves 5 independent concepts
  // ready at once, on purpose — the real dev topic's prereq chain only ever
  // has one concept ready at a time, which would make this assertion true
  // for the wrong reason. `MAX_NEW_CONCEPTS = 3` (backend/src/lib/planner.ts)
  // is what actually caps this.
  expect(body.newConcepts).toHaveLength(3);
});

test('an example_first concept skips straight to the explanation, with no try-first prompt', async ({
  page,
  request,
}) => {
  const { manyReady } = loadSessionFixtures();
  const res = await request.get(`${API}/session`, {
    headers: { Cookie: `learnos_session=${manyReady.webSessionToken}` },
  });
  const body = (await res.json()) as { newConcepts: Array<{ teachMode: string }> };
  // The fixture alternates try_first/example_first by concept order, so one
  // of the 3 concepts a session actually offers is guaranteed to be
  // example_first — deterministic, unlike the real dev topic's teach mode
  // for whichever single concept its prereq chain happens to free up next.
  const targetIndex = body.newConcepts.findIndex((c) => c.teachMode === 'example_first');
  expect(targetIndex).toBeGreaterThanOrEqual(0);

  await signInAsFixture(page, manyReady);
  await page.goto('/session');
  await expect(page.getByText(/^New concept ·/)).toBeVisible({ timeout: 30_000 });

  for (let i = 0; i < targetIndex; i += 1) {
    await skipCurrentStep(page);
  }

  // example_first sets `revealed` true immediately (SessionPage.tsx) — the
  // explanation and the retrieval card render with no "Have a go first" step
  // and no attempt textarea ever appearing for this concept.
  await expect(page.getByText('How to hold it')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Have a go first')).toHaveCount(0);
  await expect(page.getByLabel('Your attempt')).toHaveCount(0);
});

test('"I don\'t know" on a new concept reveals the explanation without a filled attempt', async ({
  page,
  request,
}) => {
  await signIn(request);
  await signInAsDev(page);
  await page.goto('/session');
  const tryFirst = page.getByText('Have a go first');
  const review = page.getByText('From an earlier day');
  // `example_first` is the third way a session can open, and these specs
  // assumed it could not happen. `pnpm seed` alternates the two teach modes, so
  // whether the next new concept opens with an attempt or straight with the
  // explanation depends on which concept is next — and on a run where that was
  // an `example_first` concept, neither label below ever appears. The tests
  // failed while the product worked correctly.
  const exampleFirst = page.getByText('How to hold it');
  await expect(tryFirst.or(exampleFirst).or(review).first()).toBeVisible({ timeout: 45_000 });
  test.skip(!(await tryFirst.isVisible()), 'no try_first concept currently due in the dev topic');

  await page.getByRole('button', { name: /i.?don.t know/i }).click();

  await expect(page.getByText('You skipped this one.')).toBeVisible();
  await expect(page.getByText('How to hold it')).toBeVisible();
});

test('"Skip this one" on a review submits no answer, and still advances', async ({ page, request }) => {
  await signIn(request);
  await makeCardsDue(request, 5);

  await signInAsDev(page);
  await page.goto('/session');
  const review = page.getByText('From an earlier day');
  const tryFirst = page.getByText('Have a go first');
  // `example_first` is the third way a session can open, and these specs
  // assumed it could not happen. `pnpm seed` alternates the two teach modes, so
  // whether the next new concept opens with an attempt or straight with the
  // explanation depends on which concept is next — and on a run where that was
  // an `example_first` concept, neither label below ever appears. The tests
  // failed while the product worked correctly.
  const exampleFirst = page.getByText('How to hold it');
  await expect(tryFirst.or(exampleFirst).or(review).first()).toBeVisible({ timeout: 45_000 });

  while (!(await review.isVisible())) {
    await skipCurrentStep(page);
  }

  // Recorded, not silently dropped (SessionPage.tsx's own comment on this
  // button): the request itself carries `response: null, confidence: null`
  // rather than the client just moving on without telling the server.
  let posted: { response: unknown; confidence: unknown } | null = null;
  await page.route('**/api/reviews', (route) => {
    posted = route.request().postDataJSON();
    route.continue();
  });

  await page.getByRole('button', { name: /skip this one/i }).click();
  await expect.poll(() => posted !== null, { timeout: 15_000 }).toBe(true);
  expect(posted).toMatchObject({ response: null, confidence: null });
});

test.describe('completion states', () => {
  /**
   * These need their own disposable users (`pnpm seed:session`), not
   * `dev@learnos.local`: completing a session inserts a `sessionDays` row for
   * *today*, and every other test in this file assumes an always-in-progress
   * session on any given calendar day the suite happens to run.
   */
  test('a topic with nothing due shows "Nothing due today", and reloading after Finish shows "Done for today"', async ({
    page,
  }) => {
    const { empty } = loadSessionFixtures();
    await signInAsFixture(page, empty);
    await page.goto('/session');

    await expect(page.getByRole('heading', { name: 'Nothing due today' })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /^finish$/i }).click();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Done for today' })).toBeVisible({ timeout: 15_000 });
  });

  test('completing a real concept shows "today done", not "nothing due"', async ({ page }) => {
    const { withWork } = loadSessionFixtures();
    await signInAsFixture(page, withWork);
    await page.goto('/session');

    await expect(page.getByText('Have a go first')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /i.?don.t know/i }).click();
    await expect(page.getByText('How to hold it')).toBeVisible();

    await answerCard(page, 'memoization');
    await tapConfidence(page, 'Certain');
    await page.getByRole('button', { name: /^check$/i }).click();
    await expect(page.getByRole('button', { name: /^next$/i })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /^next$/i }).click();

    // Curly apostrophe in the real heading (`That's today done`) — matched
    // with a wildcard so the encoding itself is never what the test asserts.
    await expect(page.getByRole('heading', { name: /That.s today done/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.summary-stat__value').first()).toHaveText('1');
  });
});
