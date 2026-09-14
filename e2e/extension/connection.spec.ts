import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mintExtensionToken, signIn } from '../api.js';
import { expect, test } from './fixtures.js';

/**
 * The connect/disconnect lifecycle (E2E-006).
 *
 * `popup.spec.ts` already covers the happy path (paste a good token, it
 * verifies, the popup answers a card) and the very first open before any
 * token exists. This covers what happens when the token is bad, revoked, or
 * deliberately cleared.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

test('a bad token is rejected, with nothing stored, and the popup still reads as disconnected', async ({
  context,
  extensionId,
}) => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByLabel(/extension token/i).fill('not-a-real-token');
  await options.getByRole('button', { name: /^connect$/i }).click();

  // Exact copy from Options.tsx's `describe()` for a 401 — proof this is the
  // server's real rejection, not a client-side guess at what a bad token
  // looks like.
  await expect(
    options.getByText('That token was not accepted. Copy a fresh one from the web app.'),
  ).toBeVisible({ timeout: 15_000 });

  // `connect()` only calls `setToken()` after `getMe()` resolves — a thrown
  // verify never reaches the write, so this isn't a race to lose.
  const stored = await options.evaluate(
    () => new Promise((resolve) => chrome.storage.local.get('learnos.token', resolve)),
  );
  expect((stored as Record<string, unknown>)['learnos.token']).toBeUndefined();

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(popup.getByText(/not connected yet/i)).toBeVisible({ timeout: 15_000 });
});

test('Disconnect clears the token, and the popup reverts to not-connected', async ({
  context,
  extensionId,
  request,
}) => {
  await signIn(request);
  const token = await mintExtensionToken(request);

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByLabel(/extension token/i).fill(token);
  await options.getByRole('button', { name: /^connect$/i }).click();
  await expect(options.getByText('dev@learnos.local')).toBeVisible({ timeout: 30_000 });

  await options.getByRole('button', { name: /^disconnect$/i }).click();
  await expect(options.getByText(/paste the token/i)).toBeVisible({ timeout: 15_000 });

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(popup.getByText(/not connected yet/i)).toBeVisible({ timeout: 15_000 });
});

test('a revoked token never hangs or shows a raw error — it reads as connected with nothing due', async ({
  context,
  extensionId,
  request,
}) => {
  await signIn(request);
  const token = await mintExtensionToken(request);

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByLabel(/extension token/i).fill(token);
  await options.getByRole('button', { name: /^connect$/i }).click();
  await expect(options.getByText('dev@learnos.local')).toBeVisible({ timeout: 30_000 });
  await options.close();

  // No HTTP route revokes an extension bearer token (`POST /auth/logout` only
  // ever reads the session *cookie*) — this is the one place that gap has to
  // be closed at the database, via a small dedicated script rather than the
  // test importing backend internals directly.
  execFileSync('pnpm', ['--filter', 'learner-os-backend', 'revoke-token', token], { cwd: ROOT, stdio: 'ignore' });

  // The popup's own `getToken()` check (Popup.tsx) never calls `/me` — a
  // stored token alone reads as connected. Only `fetchDue()` would see the
  // revoked-token 401, and its own try/catch swallows every failure —
  // offline, disconnected, revoked — to the same "nothing due" render
  // (Popup.tsx's own comment on `fetchCard`). So this is the real contract:
  // never a raw error or a hang, but also not a detected "disconnected"
  // state — that would need an extra network round trip the popup
  // deliberately doesn't spend on every open.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(popup.getByText(/Nothing due right now/)).toBeVisible({ timeout: 15_000 });
  await expect(popup.getByText(/error|exception|undefined/i)).toHaveCount(0);
});
