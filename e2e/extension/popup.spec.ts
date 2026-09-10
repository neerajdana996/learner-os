import { readFileSync } from 'node:fs';
import { answerCard, fingerprint, PARITY_FILE, type CardFingerprint } from '../card.js';
import { makeCardsDue, mintExtensionToken, signIn } from '../api.js';
import { expect, test } from './fixtures.js';

/**
 * The extension, connected and answering (T-027 → T-037, T-130).
 *
 * The unit suite proves the rules; `flow.test.ts` proves they compose over a
 * simulated day. Neither loads the extension into a browser, so neither can
 * tell you that the popup renders, that the options page stores a token, or
 * that a card the worker picked can actually be answered. That is this file.
 */
test('connects with a pasted token, then answers a real card', async ({
  context,
  extensionId,
  request,
}) => {
  // ---- what the web app's Connect screen hands the learner (T-034)
  await signIn(request);
  const token = await mintExtensionToken(request);
  const due = await makeCardsDue(request, 5);
  expect(due).toBeGreaterThan(0);

  // ---- the options page
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options.getByText(/paste the token/i)).toBeVisible();
  await options.screenshot({ path: test.info().outputPath('01-options-empty.png') });

  await options.getByLabel(/extension token/i).fill(token);
  await options.getByRole('button', { name: /^connect$/i }).click();

  // Verified against GET /me *before* it is stored, so this text is proof the
  // token reached the backend and came back with an account — not just that a
  // string was written to storage.
  await expect(options.getByText('dev@learnos.local')).toBeVisible({ timeout: 30_000 });
  await options.screenshot({ path: test.info().outputPath('02-options-connected.png') });

  // ---- the popup
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  // Opening the popup deliberately asks `/due` itself rather than rendering
  // only what the worker happened to leave behind (T-129) — and it ignores the
  // cap, the windows and the backoff on purpose, because none of those is a
  // reason to refuse someone who just asked for a question.
  await expect(popup.locator('.question__prompt')).toBeVisible({ timeout: 30_000 });
  await popup.screenshot({ path: test.info().outputPath('03-popup-card.png') });

  const ext = await fingerprint(popup, 'extension popup');
  expect(ext.answerKind).not.toBe('unknown');

  // ---- the card is the same card the web app shows
  let web: CardFingerprint | null = null;
  try {
    web = JSON.parse(readFileSync(PARITY_FILE, 'utf8')) as CardFingerprint;
  } catch {
    test.info().annotations.push({
      type: 'skipped-comparison',
      description: 'no web fingerprint on disk — run the `web` project in the same run',
    });
  }

  if (web) {
    // Not a pixel comparison: the popup is 380px wide and the session is a
    // page, so they *should* look different at the layout level. What must not
    // differ is which design system drew them. T-126 was exactly this — the
    // extension rendering the shared components in the wrong box model.
    //
    // Colour is deliberately NOT compared here, even though `fingerprint()`
    // now captures it (T-153): the web session's spaced-review card renders
    // with `.teach__card--retrieval`'s own *inverted* treatment (dark
    // background, light text — "a different kind of moment", by design),
    // which the extension's popup card was never built to have at all. A raw
    // equality check on `promptColor`/`backgroundColor` compared an inverted
    // capture against a non-inverted one and failed on a real, intentional
    // design difference, not a bug — confirmed by reading both fingerprints
    // side by side (`rgb(250,248,245)` on `rgb(43,39,35)` vs the reverse).
    // T-153's actual regression (a fieldset border) is caught directly in
    // `e2e/extension/cardActions.spec.ts` instead, where there is exactly one
    // surface and no cross-surface variant mismatch to confuse the signal.
    expect(ext.promptFont).toBe(web.promptFont);
    expect(ext.boxSizing).toBe(web.boxSizing);
    test.info().annotations.push({
      type: 'card-parity',
      description: `font "${ext.promptFont}" and box-sizing "${ext.boxSizing}" match the web session`,
    });
  }

  // ---- answering it
  await answerCard(popup);
  await popup.getByRole('button', { name: /send|check|answer/i }).first().click();

  // The gap line is the product in one sentence, and it comes from the server.
  await expect(
    popup.getByText(/since you last saw|correct|not quite|close/i).first(),
  ).toBeVisible({ timeout: 30_000 });
  await popup.screenshot({ path: test.info().outputPath('04-popup-answered.png') });
});

test('says "connect", not "nothing due", before a token exists', async ({
  context,
  extensionId,
}) => {
  // A fresh profile has no token. The popup must offer the button that fixes
  // that — the failure this guards is an extension that silently never pops
  // and gives the learner nothing to act on.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  await expect(popup.getByText(/not connected yet/i)).toBeVisible({ timeout: 30_000 });
  await expect(popup.getByRole('button', { name: /connect/i })).toBeVisible();
  await popup.screenshot({ path: test.info().outputPath('unconnected.png') });
});
