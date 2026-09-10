import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

/**
 * The adaptive diagnostic (E2E-003).
 *
 * Runs against two throwaway users seeded by `pnpm seed:diagnostic`
 * (`backend/src/scripts/seedDiagnosticUsers.ts`), each with a topic that is
 * already `active` with a straight-line chain of concepts and one recall
 * item apiece — no real generation, for the same reason `pnpm seed`'s own
 * fixtures skip it (T-074: a real map costs minutes and money per run).
 *
 * Landing on `/diagnostic/:topicId` is enough to start: `GET .../next`
 * computes the first question from scratch when `topics.diagnosticState` is
 * still null, so there is no separate "start" step in the UI
 * (`useStartDiagnosticMutation` exists in `diagnosticApi.ts` but nothing in
 * the frontend ever calls it).
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

interface DiagnosticFixture {
  userId: string;
  webSessionToken: string;
  topicId: string;
}

function reseedDiagnosticUsers(): void {
  execFileSync('pnpm', ['--filter', 'learner-os-backend', 'seed:diagnostic'], { cwd: ROOT, stdio: 'ignore' });
}

function loadFixtures(): Record<'early' | 'caps', DiagnosticFixture> {
  const path = fileURLToPath(new URL('../diagnostic-users.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as Record<'early' | 'caps', DiagnosticFixture>;
}

async function signInAs(page: Page, fixture: DiagnosticFixture): Promise<void> {
  await page.context().addCookies([
    {
      name: 'learnos_session',
      value: fixture.webSessionToken,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
    },
  ]);
}

/** Answers the item currently on screen — recall items render a plain text
 *  input labeled "Your answer" (`QuestionCard`'s recall branch). */
async function answerCurrent(page: Page, response: string, confidence: 'Guessing' | 'Certain'): Promise<void> {
  await page.getByLabel('Your answer').fill(response);
  // `Choice`'s radio is visually-hidden (`_choice.scss`'s `visually-hidden`
  // mixin) — the label is what actually receives the click.
  await page.getByText(confidence, { exact: true }).click();
  await page.getByRole('button', { name: 'Answer' }).click();
}

/**
 * Waits for the diagnostic to move on from `previousPrompt` — either a new
 * question's prompt, or the terminal "That’s the baseline" screen (which has
 * no `.question__prompt` at all).
 *
 * The mutation's response lands on the network before React finishes acting
 * on it: `answerDiagnostic`'s `onQueryStarted` re-dispatches the next
 * question into the query cache, which is a render and a passive effect
 * (`DiagnosticPage`'s `useEffect` that resets `response`/`confidence`) behind
 * the HTTP response itself. Waiting on the response alone races that chain
 * and can catch the *previous* question's now-stale, unreset input.
 */
async function waitForAdvance(page: Page, previousPrompt: string): Promise<void> {
  await page.waitForFunction(
    (prev) => {
      const q = document.querySelector('.question__prompt');
      if (q) return (q.textContent ?? '').trim() !== prev;
      // No question prompt on screen at all — the terminal summary.
      return (document.body.textContent ?? '').includes('baseline');
    },
    previousPrompt,
    { timeout: 15_000 },
  );
}

/** Drives the diagnostic to completion, capturing which concept's prompt was
 *  shown at each step (the UI never exposes the raw `conceptId`). */
async function runDiagnostic(page: Page, topicId: string, correct: (index: number) => boolean): Promise<string[]> {
  await page.goto(`/diagnostic/${topicId}`);
  const asked: string[] = [];
  let index = 0;
  let prompt = (await page.locator('.question__prompt').textContent())?.trim() ?? '';

  for (;;) {
    asked.push(prompt);
    await answerCurrent(page, correct(index) ? 'the answer' : 'nonsense', 'Certain');
    index += 1;
    if (index > 20) throw new Error('diagnostic did not terminate');
    await waitForAdvance(page, prompt);
    // Check for the terminal screen *before* reading `.question__prompt`
    // again — once `done`, that element no longer exists at all, and reading
    // it unconditionally here hangs until the locator's own timeout.
    if (await page.getByRole('heading', { name: 'That’s the baseline' }).isVisible()) break;
    prompt = (await page.locator('.question__prompt').textContent())?.trim() ?? '';
  }
  return asked;
}

test.describe('starting a question', () => {
  test.beforeEach(reseedDiagnosticUsers);

  test('the Answer button is disabled until both a response and a confidence are given', async ({ page }) => {
    const { early } = loadFixtures();
    await signInAs(page, early);
    await page.goto(`/diagnostic/${early.topicId}`);

    const answerBtn = page.getByRole('button', { name: 'Answer' });
    await expect(answerBtn).toBeDisabled();

    await page.getByLabel('Your answer').fill('the answer');
    await expect(answerBtn).toBeDisabled();

    await page.getByText('Certain', { exact: true }).click();
    await expect(answerBtn).toBeEnabled();
  });

  test('never asks how the learner learns best', async ({ page }) => {
    const { early } = loadFixtures();
    await signInAs(page, early);
    await page.goto(`/diagnostic/${early.topicId}`);

    await expect(page.getByText(/how (do|you) .* learn/i)).toHaveCount(0);
  });

  test('refreshing mid-diagnostic resumes at the same question', async ({ page }) => {
    const { early } = loadFixtures();
    await signInAs(page, early);
    await page.goto(`/diagnostic/${early.topicId}`);

    const firstPrompt = (await page.locator('.question__prompt').textContent())?.trim() ?? '';
    await answerCurrent(page, 'the answer', 'Certain');
    await waitForAdvance(page, firstPrompt);

    const secondPrompt = await page.locator('.question__prompt').textContent();
    expect(secondPrompt?.trim()).not.toBe(firstPrompt);

    await page.reload();
    await expect(page.locator('.question__prompt')).toHaveText(secondPrompt ?? '', { timeout: 15_000 });
  });
});

test.describe('finishing', () => {
  test.beforeEach(reseedDiagnosticUsers);

  test('answering every question correctly stops before the 15-question ceiling', async ({ page }) => {
    const { early } = loadFixtures();
    await signInAs(page, early);
    const asked = await runDiagnostic(page, early.topicId, () => true);

    expect(asked.length).toBeLessThan(15);

    await expect(page.getByRole('heading', { name: "That’s the baseline" })).toBeVisible();
    await expect(page.getByText(new RegExp(`${asked.length} questions`))).toBeVisible();
    await expect(page.getByText(/certain \d+ times and were right \d+ of those/)).toBeVisible();

    await page.getByRole('button', { name: 'See your map' }).click();
    await expect(page).toHaveURL(/\/map/);
  });

  test('an all-correct run and an all-wrong run ask a different sequence of concepts', async ({ page }) => {
    const { early } = loadFixtures();
    await signInAs(page, early);
    const correctSequence = await runDiagnostic(page, early.topicId, () => true);

    reseedDiagnosticUsers();
    const { early: reseededEarly } = loadFixtures();
    await signInAs(page, reseededEarly);
    const wrongSequence = await runDiagnostic(page, reseededEarly.topicId, () => false);

    // Same 12-concept chain both times (fixed by the seed script), but the
    // adaptive engine (backend/src/lib/diagnostic.ts) propagates a correct
    // answer's confidence up to prerequisites and a wrong answer's doubt down
    // to dependents — a purely-random or fixed-order picker would have no
    // reason to land on a different sequence.
    expect(wrongSequence).not.toEqual(correctSequence);
  });

  test('caps at exactly 15 questions on a large map with alternating answers, and the calibration numbers are consistent', async ({
    page,
  }) => {
    const { caps } = loadFixtures();
    await signInAs(page, caps);
    const asked = await runDiagnostic(page, caps.topicId, (i) => i % 2 === 0);

    expect(asked).toHaveLength(15);
    await expect(page.getByRole('heading', { name: "That’s the baseline" })).toBeVisible();

    // Every answer here was given at "Certain" confidence, and only half were
    // actually right — a calibration invariant (sureCorrectCount <=
    // sureCount) that would catch a swapped numerator for free.
    const summary = await page.locator('p', { hasText: /questions\. You said you were certain/ }).textContent();
    const match = summary?.match(/(\d+) questions\. You said you were certain (\d+) times and were right (\d+)/);
    expect(match).not.toBeNull();
    const [, askedCount, sureCount, sureCorrectCount] = match as unknown as [string, string, string, string];
    expect(Number(askedCount)).toBe(15);
    expect(Number(sureCount)).toBe(15);
    expect(Number(sureCorrectCount)).toBeLessThan(Number(sureCount));
  });
});
