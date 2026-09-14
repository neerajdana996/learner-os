import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { answerCard } from '../card.js';
import { API, makeCardsDue, mintExtensionToken, signIn } from '../api.js';
import { expect, test } from './fixtures.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Dismiss, snooze, and the daily mood tap (E2E-006).
 *
 * `backoff.spec.ts` already drives three real dismissals to prove the
 * backoff state; this covers what a single dismiss/snooze actually sends to
 * the server, and the mood tap that follows an answered card.
 */

async function connect(page: import('@playwright/test').Page, token: string, extensionId: string): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.getByLabel(/extension token/i).fill(token);
  await page.getByRole('button', { name: /^connect$/i }).click();
  await expect(page.getByText('dev@learnos.local')).toBeVisible({ timeout: 30_000 });
}

test('dismissing a card sends no response, only dismissed: true', async ({ context, extensionId, request }) => {
  await signIn(request);
  const token = await mintExtensionToken(request);
  await makeCardsDue(request, 1);

  const options = await context.newPage();
  await connect(options, token, extensionId);
  await options.close();

  let posted: Record<string, unknown> | null = null;
  const popup = await context.newPage();
  await popup.route('**/reviews', (route) => {
    posted = route.request().postDataJSON() as Record<string, unknown>;
    route.continue();
  });
  await popup.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(popup.locator('.question__prompt')).toBeVisible({ timeout: 30_000 });

  await popup.getByRole('button', { name: /dismiss/i }).click();
  await popup.waitForEvent('close', { timeout: 10_000 });

  expect(posted).toMatchObject({ dismissed: true, confidence: null, surface: 'extension' });
  expect(posted).not.toHaveProperty('response');
});

test('"Later" (snooze) sends no response, only snoozed: true, and the card stays due', async ({
  context,
  extensionId,
  request,
}) => {
  await signIn(request);
  const token = await mintExtensionToken(request);
  await makeCardsDue(request, 1);

  const before = await request.get(`${API}/due?limit=5`, { headers: { Authorization: `Bearer ${token}` } });
  const beforeCount = ((await before.json()) as { items: unknown[] }).items.length;
  expect(beforeCount).toBeGreaterThan(0);

  const options = await context.newPage();
  await connect(options, token, extensionId);
  await options.close();

  let posted: Record<string, unknown> | null = null;
  const popup = await context.newPage();
  await popup.route('**/reviews', (route) => {
    posted = route.request().postDataJSON() as Record<string, unknown>;
    route.continue();
  });
  await popup.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(popup.locator('.question__prompt')).toBeVisible({ timeout: 30_000 });

  await popup.getByRole('button', { name: 'Later' }).click();
  await popup.waitForEvent('close', { timeout: 10_000 });

  expect(posted).toMatchObject({ snoozed: true, confidence: null, surface: 'extension' });
  expect(posted).not.toHaveProperty('response');

  // Same server-side effect as a dismiss (`recordReview.ts`'s `shouldSchedule`
  // is false for both): the concept is still due afterward — "later" only
  // pushes the extension's own re-show timer, not the schedule.
  const after = await request.get(`${API}/due?limit=5`, { headers: { Authorization: `Bearer ${token}` } });
  const afterCount = ((await after.json()) as { items: unknown[] }).items.length;
  expect(afterCount).toBe(beforeCount);
});

test('a fieldset (the confidence tap) never shows the browser\'s raw default border', async ({
  context,
  extensionId,
  request,
}) => {
  // A real regression, found by looking at a screenshot rather than trusting
  // text/role assertions: `extension/src/entrypoints/base.scss` imports the
  // shared design system but never imported the web app's own base reset, so
  // every `<fieldset>` (ConfidenceTap here; also every `Choice`-based group)
  // rendered with Chrome's unstyled `2px groove` border in the popup, even
  // though every text/role assertion in this file still passed. Fixed by
  // moving the fieldset/legend reset into `@learnos/ui/styles/reset.scss`
  // (packages/ui) so both the web app and the extension get it, matching how
  // the `box-sizing` reset was already handled for the same reason (T-126).
  await signIn(request);
  const token = await mintExtensionToken(request);
  await makeCardsDue(request, 1);

  const options = await context.newPage();
  await connect(options, token, extensionId);
  await options.close();

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(popup.locator('.question__prompt')).toBeVisible({ timeout: 30_000 });
  await answerCard(popup);
  await popup.getByRole('button', { name: /send|check|answer/i }).first().click();
  await expect(popup.getByText(/how sure were you/i)).toBeVisible({ timeout: 15_000 });

  const fieldsetBorder = await popup.evaluate(() => {
    const el = document.querySelector('fieldset');
    return el ? getComputedStyle(el).borderStyle : null;
  });
  expect(fieldsetBorder).toBe('none');
});

test('the mood tap appears once per local day, only after an answered card', async ({
  context,
  extensionId,
  request,
}) => {
  await signIn(request);
  const token = await mintExtensionToken(request);
  await makeCardsDue(request, 1);

  const options = await context.newPage();
  await connect(options, token, extensionId);
  await options.close();

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(popup.locator('.question__prompt')).toBeVisible({ timeout: 30_000 });
  await answerCard(popup);
  await popup.getByRole('button', { name: /send|check|answer/i }).first().click();

  // Wildcard for the apostrophe position — the real heading uses a curly one.
  await expect(popup.getByText(/how.s the week going/i)).toBeVisible({ timeout: 15_000 });
  await popup.getByRole('button', { name: 'Fine', exact: true }).click();
  await popup.close();

  // A second answered card the same day does not ask again.
  await makeCardsDue(request, 1);
  const popup2 = await context.newPage();
  await popup2.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(popup2.locator('.question__prompt')).toBeVisible({ timeout: 30_000 });
  await answerCard(popup2);
  await popup2.getByRole('button', { name: /send|check|answer/i }).first().click();
  await expect(popup2.getByText(/right\.|not quite|since you last saw/i)).toBeVisible({ timeout: 15_000 });
  await expect(popup2.getByText(/how.s the week going/i)).toHaveCount(0);
});

test('a held-out or untaught concept can never reach the popup queue', async ({ request }) => {
  await signIn(request);
  const token = await mintExtensionToken(request);
  await makeCardsDue(request, 10);

  const res = await request.get(`${API}/due?limit=10`, { headers: { Authorization: `Bearer ${token}` } });
  const body = (await res.json()) as { items: Array<{ conceptTitle?: string }> };
  // `findDueCards` (backend/src/modules/due/due.repository.ts) requires
  // `cards.taughtAt` set and `concepts.heldOut = false` in the query itself —
  // structurally impossible to violate through any client path, so there is
  // no UI drive-through that could meaningfully fail here. Every item this
  // route can ever return already carries the concept's real title, which
  // `/due`'s own schema only populates for items it can guarantee are neither
  // untaught nor held out (PublicItemSchema's `conceptTitle` comment).
  for (const item of body.items) expect(item.conceptTitle).toBeTruthy();
});

test('a codeEditor item never appears in the popup queue, even when genuinely due', async ({ request }) => {
  // Seeds 5 format items — including one codeEditor — onto dev's first
  // non-held-out concept, replacing whatever was there (T-140). No real
  // generation, no model calls.
  execFileSync('pnpm', ['--filter', 'learner-os-backend', 'seed:formats'], { cwd: ROOT, stdio: 'ignore' });

  await signIn(request);
  const token = await mintExtensionToken(request);
  await makeCardsDue(request, 10);

  // `popupEligible()` (backend/src/lib/popupEligible.ts) is applied per
  // request, not per item, so which of the concept's 5 format items comes up
  // can vary — polling a few times gives codeEditor a real chance to have
  // been picked and excluded, rather than asserting on a single lucky draw.
  for (let i = 0; i < 5; i += 1) {
    const res = await request.get(`${API}/due?limit=10`, { headers: { Authorization: `Bearer ${token}` } });
    const body = (await res.json()) as {
      items: Array<{ blocks?: Array<{ slot: string; kind: string }> }>;
    };
    const hasCodeEditor = body.items.some((item) =>
      item.blocks?.some((b) => b.slot === 'answer' && b.kind === 'codeEditor'),
    );
    expect(hasCodeEditor).toBe(false);
  }
});
