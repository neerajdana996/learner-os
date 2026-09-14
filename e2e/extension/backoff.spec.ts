import { expect, test } from './fixtures.js';
import { makeCardsDue, signIn } from '../api.js';
import { mintExtensionToken } from '../api.js';

/**
 * Three dismissals in a row, through the real popup (E2E-006, plan.md §4).
 *
 * `extension/src/__tests__/flow.test.ts` (T-037) proves `recordDismissed` and
 * `shouldShow` as pure functions — it never opens a popup. What it cannot
 * prove is that three real clicks on a real "Dismiss" button leave
 * `chrome.storage.local` in the state those functions expect, or that
 * `Popup.tsx` actually reads `backoffUntil` back out and renders the right
 * copy. That gap is what this file closes.
 *
 * One mechanical fact drives this test's shape: **dismissing a card does not
 * reschedule it** (`recordReview.ts`: `shouldScheduled` is false whenever
 * `answer.dismissed`), and the popup's own `/due` fetch deliberately bypasses
 * the backoff on a manual open (T-129) — "none of them is a reason to refuse
 * a person who just asked for a question". So a dismissed card stays due and
 * keeps being served on every subsequent manual open, no matter how many
 * times it's waved away. The backoff only becomes *visible* once `/due`
 * genuinely has nothing left to serve — a state three dismissals alone cannot
 * produce, since dismissing never clears "due". The 4th open below is
 * intercepted to simulate exactly that "nothing left due" moment; the
 * backoff state itself is entirely real, produced by three real clicks.
 */
test('three dismissals in the real UI set a real backoff, and the popup reads it back', async ({
  context,
  extensionId,
  request,
}) => {
  await signIn(request);
  const token = await mintExtensionToken(request);
  await makeCardsDue(request, 1);

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByLabel(/extension token/i).fill(token);
  await options.getByRole('button', { name: /^connect$/i }).click();
  await expect(options.getByText('dev@learnos.local')).toBeVisible({ timeout: 30_000 });
  await options.close();

  // ---- three real dismissals, three real popup opens
  //
  // Card.tsx's dismiss() awaits every storage write (send, clearCardOpen,
  // setPopState) and only *then* calls onClose, which is `window.close()` in
  // Popup.tsx — so the popup closes itself once the state this test checks is
  // already durable. Waiting for that close event is the precise signal, not
  // a fixed delay guessing how long the writes take.
  for (let i = 1; i <= 3; i += 1) {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(popup.locator('.question__prompt')).toBeVisible({ timeout: 30_000 });
    await popup.getByRole('button', { name: /dismiss/i }).click();
    await popup.waitForEvent('close', { timeout: 10_000 });
  }

  // ---- the state three real clicks produced, read directly (not asserted by
  // inference from the UI) — proves the click handler actually wrote what
  // schedule.ts's recordDismissed says it should.
  const [worker] = context.serviceWorkers();
  if (!worker) throw new Error('service worker not found');
  const popState = await worker.evaluate(
    () => new Promise((resolve) => chrome.storage.local.get('learnos.popState', resolve)),
  );
  const state = (popState as Record<string, { consecutiveDismissals?: number; backoffUntil?: number | null }>)[
    'learnos.popState'
  ];
  expect(state?.consecutiveDismissals).toBe(3);
  expect(state?.backoffUntil).not.toBeNull();
  expect(state?.backoffUntil).toBeGreaterThan(Date.now());

  // ---- the one precondition three dismissals cannot produce on their own —
  // the card stays due forever until it's actually answered, so "nothing due"
  // is simulated for this one request rather than chased through more clicks.
  const popup = await context.newPage();
  await popup.route('**/due*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) }),
  );
  await popup.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // The exact copy from Popup.tsx, driven by state this test produced for
  // real and a due-response this test had to simulate for the reason above.
  await expect(popup.getByText(/resting until tomorrow.*waved off three in a row/i)).toBeVisible({
    timeout: 15_000,
  });
  await popup.screenshot({ path: test.info().outputPath('backoff.png') });
});

test('a card that was dismissed stays due — it is not silently resolved', async ({
  context,
  extensionId,
  request,
}) => {
  // The mechanical fact the backoff test above depends on, asserted directly:
  // dismissing does not reschedule (recordReview.ts's `shouldSchedule` is
  // false for `answer.dismissed`), so the concept is still due afterward. If
  // this ever starts failing, the backoff test above needs to be redesigned,
  // not just patched — it would mean the product's scheduling behavior
  // changed.
  //
  // Checked by count, not by exact question text: `due.service.ts` rotates to
  // an "unseen" item from the same concept's pool once one item has a recent
  // reviewEvent against it (by design — showing the identical question twice
  // in a row would be a worse regression than this test, not a better one).
  // So the concept persisting as due is the invariant; which item currently
  // represents it is allowed to change.
  await signIn(request);
  const token = await mintExtensionToken(request);
  await makeCardsDue(request, 1);

  const before = await request.get('http://localhost:3001/due?limit=5', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const beforeCount = ((await before.json()) as { items: unknown[] }).items.length;
  expect(beforeCount).toBeGreaterThan(0);

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByLabel(/extension token/i).fill(token);
  await options.getByRole('button', { name: /^connect$/i }).click();
  await expect(options.getByText('dev@learnos.local')).toBeVisible({ timeout: 30_000 });
  await options.close();

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(popup.locator('.question__prompt')).toBeVisible({ timeout: 30_000 });
  await popup.getByRole('button', { name: /dismiss/i }).click();
  // Self-closes once its storage write lands (see the note in the test above).
  await popup.waitForEvent('close', { timeout: 10_000 });

  const after = await request.get('http://localhost:3001/due?limit=5', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const afterCount = ((await after.json()) as { items: unknown[] }).items.length;
  expect(afterCount).toBe(beforeCount);
});
