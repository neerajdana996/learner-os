import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

/**
 * Every card the product can show, rendered from real data (E2E-008).
 *
 * **What this is for.** The five answer surfaces and the six content blocks
 * are all built and unit-tested, and until this spec almost none of them had
 * been rendered from a database row by anything — T-118 shipped `numeric`
 * half-built for exactly that reason. The seeded fixture
 * (`pnpm seed:formats:showcase`) puts **one card per concept**, because the
 * scheduler serves one item per due concept: several on one concept shows
 * whichever the queue picked, which is how this stayed unnoticed.
 *
 * **The same kind appears on different data on purpose.** A code listing is
 * not broken by its kind, it is broken by its content — margin notes push the
 * gutter, a dimmed range changes what is emphasised, a twelve-line listing is
 * the one that overflows. `code-short`, `code-notes` and `code-dimmed` are the
 * same block kind three ways, and `diagram-small`/`diagram-full` are the graph
 * at its minimum and at the five-node cap.
 *
 * Every card is screenshotted and attached to the HTML report, so
 * `pnpm e2e:report` is a contact sheet of every question surface the product
 * can show. That is the deliverable as much as the assertions are.
 *
 * Grading each answer format — filling the hole, clicking the line, the
 * numeric tolerance edges — is the rest of E2E-008 and is not here yet. This
 * proves each card *renders*, which is the regression class that shipped.
 */

/**
 * What each case must put on screen. An answer format falling through to the
 * generic text box is the T-118 bug, and a content block that renders nothing
 * would leave a card that still "passes" on its prompt alone — so every case
 * names an element that only it produces.
 */
const REQUIRED: Record<string, string> = {
  clozeCode: '.cloze__hole',
  hotspotLine: '.hotspot__grid',
  orderLines: '.order__line',
  numeric: '#numeric-answer',
  codeEditor: '.editor__area',
  prose: '.blocks__item',
  'code-short': '.code__scroll',
  'code-notes': '.code__scroll',
  'code-dimmed': '.code__scroll',
  codeDiff: '.code-diff',
  terminal: '.terminal',
  // The web app renders a diagram interactively through ReactFlow rather than
  // placing the worker's flattened SVG (T-108, revised 2026-09-11), so this
  // selector is also what proves the xyflow path is wired on this surface.
  'diagram-small': '.react-flow',
  'diagram-full': '.react-flow',
  // A swimlane is not a node graph, so `sequence` keeps the static SVG.
  sequence: '.drawing',
};

const ARTIFACTS = fileURLToPath(new URL('../.artifacts/formats', import.meta.url));

interface FormatFixture {
  webSessionToken: string;
  kinds: string[];
  cards: { slug: string; prompt: string }[];
}

function loadFixture(): FormatFixture {
  const path = fileURLToPath(new URL('../format-user.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as FormatFixture;
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

test.describe('every card renders its own surface', () => {
  test('walks the showcase and captures each card', async ({ page }) => {
    const fixture = loadFixture();
    mkdirSync(ARTIFACTS, { recursive: true });

    await page.context().addCookies([
      { name: 'learnos_session', value: fixture.webSessionToken, domain: 'localhost', path: '/', httpOnly: true },
    ]);

    await page.goto('/session');
    await expect(page.locator('.question__prompt').first()).toBeVisible();

    const seen = new Set<string>();
    const missingSurface: string[] = [];

    // Bounded rather than `while (true)`: a session that stops advancing is a
    // bug worth failing on, not one worth hanging the suite for.
    for (let step = 0; step < 40; step += 1) {
      // The last `advance()` can land on the session-complete screen, which has
      // no prompt at all — that is the walk finishing, not a failure.
      const promptEl = page.locator('.question__prompt').first();
      if (!(await promptEl.isVisible().catch(() => false))) break;

      const prompt = await promptEl.textContent();
      const card = fixture.cards.find((c) => prompt?.trim() === c.prompt);

      if (card && !seen.has(card.slug)) {
        seen.add(card.slug);

        const selector = REQUIRED[card.slug];
        if (selector && !(await page.locator(selector).first().isVisible().catch(() => false))) {
          missingSurface.push(`${card.slug} (expected ${selector})`);
        }

        const file = `${ARTIFACTS}/${card.slug}.png`;
        await page.screenshot({ path: file, fullPage: true });
        await test.info().attach(`card: ${card.slug}`, { path: file, contentType: 'image/png' });
      }

      if (!(await advance(page))) break;
      await page.waitForTimeout(200);
    }

    expect(missingSurface, 'cards that rendered without their own surface').toEqual([]);

    // Every card, and nothing else. `codeEditor` used to be excluded here as
    // never a review (T-088); since T-171 it is a review on both surfaces.
    expect([...seen].sort()).toEqual([...fixture.kinds].sort());
    expect(seen.has('codeEditor'), 'a codeEditor is a review since T-171').toBe(true);
  });
});
