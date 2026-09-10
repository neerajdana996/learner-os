import { expect, test } from './fixtures.js';
import { makeCardsDue, mintExtensionToken, signIn } from '../api.js';

/**
 * The offline queue, driven through the real UI (E2E-014, T-037's known gap).
 *
 * `extension/src/__tests__/flow.test.ts` proves the queue's retry rules as
 * pure functions against `fakeBrowser` and a mocked `send`. What it
 * structurally cannot prove is that a **real** offline browser, a **real**
 * popup, and a **real** backend agree with each other once the network
 * actually comes back — that gap is exactly what this file closes.
 *
 * `context.setOffline` is CDP-level network emulation; the extension's own
 * `fetch` calls see it exactly as a learner's dropped wifi would.
 */
test('an answer given offline is queued, shown as kept, and drains once back online', async ({
  context,
  extensionId,
  request,
}) => {
  await signIn(request);
  const token = await mintExtensionToken(request);
  await makeCardsDue(request, 1);

  // ---- connect while still online
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByLabel(/extension token/i).fill(token);
  await options.getByRole('button', { name: /^connect$/i }).click();
  await expect(options.getByText('dev@learnos.local')).toBeVisible({ timeout: 30_000 });
  await options.close();

  // ---- fetch the due card while still online (the popup's own /due fetch,
  // T-129 — it cannot get a card at all once offline), *then* drop the
  // network. This is the real sequence: a card is already on screen, and the
  // learner's connection drops while they're answering it.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.locator('.question__prompt')).toBeVisible({ timeout: 30_000 });

  await context.setOffline(true);
  await popup.screenshot({ path: test.info().outputPath('01-card-offline.png') });

  const { answerCard } = await import('../card.js');
  await answerCard(popup);
  await popup.getByRole('button', { name: /send|check|answer/i }).first().click();

  // The exact copy from Card.tsx — a learner who is offline is told their
  // answer was kept, not shown a raw network error.
  await expect(popup.getByText(/saved.*you.re offline/i)).toBeVisible({ timeout: 15_000 });
  await popup.screenshot({ path: test.info().outputPath('02-card-queued.png') });

  // ---- confirm it actually landed in the queue, not just displayed as if it did
  const queuedBefore = await popup.evaluate(
    () => new Promise((resolve) => chrome.storage.local.get('learnos.queue', resolve)),
  );
  const entriesBefore = (queuedBefore as Record<string, unknown[]>)['learnos.queue'] ?? [];
  expect(entriesBefore).toHaveLength(1);
  await popup.close();

  // ---- back online — the worker's `online` listener is best-effort per its
  // own comment ("worth having, worth nothing to rely on"); the alarm is what
  // actually guarantees the drain. Dispatching the event directly on the
  // service worker's global scope exercises exactly that listener without
  // waiting five real minutes for the alarm, which is the only thing standing
  // between "the code path exists" and "it demonstrably runs".
  await context.setOffline(false);

  const [worker] = context.serviceWorkers();
  if (!worker) throw new Error('service worker not found — was it evicted?');

  await worker.evaluate(() => {
    self.dispatchEvent(new Event('online'));
  });

  // The drain is async and fire-and-forget from the listener's point of view
  // (`void sync().catch(...)`), so poll rather than assume it finished the
  // instant the event returns.
  await expect
    .poll(
      async () => {
        const stored = await worker.evaluate(
          () => new Promise((resolve) => chrome.storage.local.get('learnos.queue', resolve)),
        );
        return ((stored as Record<string, unknown[]>)['learnos.queue'] ?? []).length;
      },
      { timeout: 15_000, message: 'the queue never drained after coming back online' },
    )
    .toBe(0);
});

test('a queued answer is not lost if the popup is closed before it drains', async ({
  context,
  extensionId,
  request,
}) => {
  // The same setup, but this time the popup is closed immediately after
  // queuing — an MV3 popup is destroyed the instant it loses focus, and the
  // queue's whole design (chrome.storage.local, not memory) exists because of
  // that. This asserts the queue survives the popup's death, not just a
  // network drop.
  await signIn(request);
  const token = await mintExtensionToken(request);
  await makeCardsDue(request, 1);

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByLabel(/extension token/i).fill(token);
  await options.getByRole('button', { name: /^connect$/i }).click();
  await expect(options.getByText('dev@learnos.local')).toBeVisible({ timeout: 30_000 });
  await options.close();

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.locator('.question__prompt')).toBeVisible({ timeout: 30_000 });

  await context.setOffline(true);
  const { answerCard } = await import('../card.js');
  await answerCard(popup);
  await popup.getByRole('button', { name: /send|check|answer/i }).first().click();
  await expect(popup.getByText(/saved.*you.re offline/i)).toBeVisible({ timeout: 15_000 });

  // The popup dies. The queue must not.
  await popup.close();
  await context.setOffline(false);

  const [worker] = context.serviceWorkers();
  if (!worker) throw new Error('service worker not found');
  await worker.evaluate(() => self.dispatchEvent(new Event('online')));

  await expect
    .poll(
      async () => {
        const stored = await worker.evaluate(
          () => new Promise((resolve) => chrome.storage.local.get('learnos.queue', resolve)),
        );
        return ((stored as Record<string, unknown[]>)['learnos.queue'] ?? []).length;
      },
      { timeout: 15_000 },
    )
    .toBe(0);
});
