import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

/**
 * Every answer format, rendered from real data (E2E-008).
 *
 * **What this is for.** `clozeCode`, `hotspotLine`, `orderLines`, `numeric`
 * and `codeEditor` are all built and unit-tested, and until this spec none of
 * them had ever been rendered from a database row by anything — T-118 shipped
 * `numeric` half-built for exactly that reason. The seeded fixture
 * (`pnpm seed:formats:showcase`) puts **one format per concept**, because the
 * scheduler serves one item per due concept: all five on a single concept
 * shows whichever the queue picked, which is how this stayed unnoticed.
 *
 * Each format is screenshotted and attached to the HTML report, so
 * `pnpm e2e:report` is a contact sheet of every question surface the product
 * can show. That is the deliverable as much as the assertions are.
 *
 * Grading each format — filling the hole, clicking the line, ordering the
 * lines, the numeric tolerance edges — is the rest of E2E-008 and is not here
 * yet. This proves each surface *renders*, which is the regression class that
 * actually shipped.
 */

/** The dedicated surface each format must render. A format falling through to
 *  the generic text box is the T-118 bug, so these selectors are the assertion
 *  and not merely a way to find the element. */
const SURFACE: Record<string, string> = {
  clozeCode: '.cloze__hole',
  hotspotLine: '.hotspot__grid',
  orderLines: '.order__line',
  numeric: '#numeric-answer',
  codeEditor: '.editor__area',
};

/** `codeEditor` is never a review (T-088), so `reviewEligible()` filters it out
 *  of every queue a session draws from. Its row exists; it must not appear. */
const NOT_IN_A_SESSION = 'codeEditor';

const ARTIFACTS = fileURLToPath(new URL('../.artifacts/formats', import.meta.url));

interface FormatFixture {
  userId: string;
  webSessionToken: string;
  topicId: string;
  kinds: string[];
}

function loadFixture(): FormatFixture {
  const path = fileURLToPath(new URL('../format-user.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as FormatFixture;
}

/** Which format is on screen, or null if this step is not a format card. */
async function visibleFormat(page: Page): Promise<string | null> {
  for (const [kind, selector] of Object.entries(SURFACE)) {
    if (await page.locator(selector).first().isVisible().catch(() => false)) return kind;
  }
  return null;
}

/**
 * Moves past whatever is on screen without answering it. A review step is
 * already revealed and needs only "Skip this one"; a teaching step needs
 * "I don't know" first. Returns false when neither button is there, which is
 * how the walk knows the session has ended.
 */
async function advance(page: Page): Promise<boolean> {
  const dontKnow = page.getByRole('button', { name: /i.?don.t know/i });
  if (await dontKnow.isVisible().catch(() => false)) await dontKnow.click();

  const skip = page.getByRole('button', { name: /skip this one/i });
  if (!(await skip.isVisible().catch(() => false))) return false;
  await skip.click();
  return true;
}

test.describe('every answer format renders its own surface', () => {
  test('walks the format showcase and captures each card', async ({ page }) => {
    const fixture = loadFixture();
    mkdirSync(ARTIFACTS, { recursive: true });

    await page.context().addCookies([
      { name: 'learnos_session', value: fixture.webSessionToken, domain: 'localhost', path: '/', httpOnly: true },
    ]);

    await page.goto('/session');
    await expect(page.locator('.question__prompt').first()).toBeVisible();

    const seen = new Map<string, string>();

    // Bounded rather than `while (true)`: a session that stops advancing is a
    // bug worth failing on, not one worth hanging the suite for.
    for (let step = 0; step < 20; step += 1) {
      const kind = await visibleFormat(page);

      if (kind && !seen.has(kind)) {
        const file = `${ARTIFACTS}/${kind}.png`;
        await page.screenshot({ path: file, fullPage: true });
        await test.info().attach(`format: ${kind}`, { path: file, contentType: 'image/png' });
        seen.set(kind, file);
      }

      if (!(await advance(page))) break;
      await page.waitForTimeout(200);
    }

    // Every format the session is allowed to serve, and nothing else.
    const expected = fixture.kinds.filter((k) => k !== NOT_IN_A_SESSION);
    expect([...seen.keys()].sort()).toEqual([...expected].sort());
    expect(seen.has(NOT_IN_A_SESSION), 'a codeEditor is never a review (T-088)').toBe(false);
  });
});
