import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { API, fetchMap, firstTopicId, signIn } from '../api.js';
import { signInAsDev } from '../ui.js';

/**
 * The map and knowledge score (E2E-005).
 *
 * `pnpm seed`'s own dev topic never produces a `known` concept — `known`
 * needs both a taught card *and* a high diagnostic estimate
 * (`backend/src/lib/score.ts`), and the dev fixture never writes
 * `topics.diagnosticState`. The state/legend tests below run against
 * `pnpm seed:map`'s own small fixture instead, which places one concept in
 * each of the five interesting cells (`heldout`, `untaught`, `taught`,
 * `taught` + `atRisk`, `known`) on purpose.
 */

interface MapFixture {
  userId: string;
  webSessionToken: string;
  topicId: string;
}

function loadMapFixture(): MapFixture {
  const path = fileURLToPath(new URL('../map-user.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as MapFixture;
}

async function signInAsFixture(page: Page, fixture: MapFixture): Promise<void> {
  await page.context().addCookies([
    { name: 'learnos_session', value: fixture.webSessionToken, domain: 'localhost', path: '/', httpOnly: true },
  ]);
}

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

test('every ConceptState renders distinctly, and an atRisk concept shows as Slipping', async ({ page }) => {
  const fixture = loadMapFixture();
  await signInAsFixture(page, fixture);
  await page.goto('/map');

  // The legend itself only ever has 4 rows — `known` folds into "Solid"
  // alongside `taught` (`ConceptLegend` in `packages/ui/src/ConceptDot.tsx`).
  // Both concepts land in that one bucket, so the count is 2, not 1.
  await expect(page.getByText('Solid · 2')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Slipping · 1')).toBeVisible();
  await expect(page.getByText('Not taught yet · 1')).toBeVisible();
  await expect(page.getByText('Held back · 1')).toBeVisible();

  // `known` vs plain `taught` is only distinguishable per tile, via the dot's
  // own accessible name — never in the legend, which the checks above cover.
  const knownTile = page.locator('.concept', { hasText: 'Known concept' });
  await expect(knownTile.getByRole('img', { name: 'Already knew it' })).toBeVisible();
  const solidTile = page.locator('.concept', { hasText: 'Solid concept' });
  await expect(solidTile.getByRole('img', { name: 'Solid' })).toBeVisible();

  // The at-risk concept gets its own banner above the legend, and its tile
  // carries the risk styling and dot.
  await expect(page.getByText('One is slipping')).toBeVisible();
  const slippingTile = page.locator('.concept', { hasText: 'Slipping concept' });
  await expect(slippingTile).toHaveClass(/concept--risk/);
  await expect(slippingTile.getByRole('img', { name: 'Slipping' })).toBeVisible();

  await page.screenshot({ path: test.info().outputPath('all-states.png'), fullPage: true });
});

test('prerequisite edges are shaped correctly on the wire', async ({ request }) => {
  await signIn(request);
  const topicId = await firstTopicId(request);
  const res = await request.get(`${API}/topics/${topicId}/map`);
  const body = (await res.json()) as { concepts: Array<{ conceptId: string }>; edges: Array<{ from: string; to: string }> };

  // Honest scope: `MapPage.tsx` never reads `edges` at all today — no lines,
  // arrows, or greyed-out gating tied to prerequisites, confirmed by reading
  // the whole component. There is no visual graph to assert against yet, so
  // this only checks the contract the API actually makes: every edge names
  // two concepts that are genuinely in this topic's map.
  expect(body.edges.length).toBeGreaterThan(0);
  const conceptIds = new Set(body.concepts.map((c) => c.conceptId));
  for (const edge of body.edges) {
    expect(conceptIds.has(edge.from)).toBe(true);
    expect(conceptIds.has(edge.to)).toBe(true);
  }
});

test('a concept tile is not interactive, and a held-out tile leaks nothing beyond the placeholder', async ({
  page,
}) => {
  const fixture = loadMapFixture();
  await signInAsFixture(page, fixture);
  await page.goto('/map');
  await expect(page.getByText('Held back ·')).toBeVisible({ timeout: 15_000 });

  const heldOutTile = page.locator('.concept', { hasText: 'Held back until day 30' });
  await expect(heldOutTile).toBeVisible();

  // No click affordance at all — a plain `<div>`, not a button, link, or
  // anything with a click handler (confirmed by reading `MapPage.tsx`: no
  // `onClick`, no `<a>`/`<Link>`, no modal or tooltip trigger anywhere).
  await expect(heldOutTile).not.toHaveJSProperty('onclick', expect.anything());
  await expect(heldOutTile.locator('a, button')).toHaveCount(0);

  // The only visible content is the placeholder text and a bare "?" — no
  // title, aria-label, data attribute, or href carries the real concept name.
  const attrs = await heldOutTile.evaluate((el) =>
    Array.from(el.querySelectorAll('*'))
      .concat(el)
      .flatMap((node) => Array.from(node.attributes).map((a) => `${a.name}=${a.value}`)),
  );
  const leaked = attrs.filter((a) => /title|href|data-/.test(a.split('=')[0] ?? ''));
  expect(leaked).toEqual([]);
});

test('/map and /map/:topicId render the same content, and another user\'s topic 404s', async ({ page, request }) => {
  await signIn(request);
  const topicId = await firstTopicId(request);

  await signInAsDev(page);
  await page.goto('/map');
  await expect(page.getByText(/Held back ·/)).toBeVisible({ timeout: 30_000 });
  const viaBareRoute = await page.getByText(/Held back ·/).textContent();

  await page.goto(`/map/${topicId}`);
  await expect(page.getByText(/Held back ·/)).toBeVisible({ timeout: 30_000 });
  const viaExplicitRoute = await page.getByText(/Held back ·/).textContent();
  expect(viaExplicitRoute).toBe(viaBareRoute);

  // Someone else's topic id 404s rather than confirming it exists (mirrors
  // the backend's own unit test, map.test.ts).
  const fixture = loadMapFixture();
  const res = await request.get(`${API}/topics/${fixture.topicId}/map`);
  expect(res.status()).toBe(404);
});
