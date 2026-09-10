import { expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The shared `QuestionCard` (`@learnos/ui`), as it appears on a screen.
 *
 * One component renders every question in the product — the diagnostic, the
 * session, the day-30 test and the extension popup — so the *design* cannot
 * drift between them by construction. What can still drift is the CSS each
 * surface loads around it: the extension is a 380px popup on its own origin
 * with its own stylesheet entry, and T-126 is exactly that bug (the design
 * system rendered in the wrong box model). These helpers capture what the card
 * actually computes to, so the two surfaces can be compared rather than
 * assumed identical.
 */
export const PARITY_FILE = fileURLToPath(new URL('./.artifacts/card-parity.json', import.meta.url));

export interface CardFingerprint {
  surface: string;
  prompt: string;
  /** The answer surface the card chose for this item's type. */
  answerKind: 'radio' | 'text' | 'textarea' | 'number' | 'unknown';
  promptFont: string;
  promptColor: string;
  boxSizing: string;
}

/** Reads what the card computed to, rather than what the stylesheet says. */
export async function fingerprint(page: Page, surface: string): Promise<CardFingerprint> {
  const prompt = page.locator('.question__prompt').first();
  await expect(prompt).toBeVisible();

  const styles = await prompt.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { font: cs.fontFamily, color: cs.color, boxSizing: cs.boxSizing };
  });

  const answerKind = await page.evaluate(() => {
    if (document.querySelector('input[type="radio"][name="answer"]')) return 'radio' as const;
    if (document.querySelector('input#numeric-answer')) return 'number' as const;
    if (document.querySelector('textarea[aria-label="Your answer"]')) return 'textarea' as const;
    if (document.querySelector('input[aria-label="Your answer"]')) return 'text' as const;
    return 'unknown' as const;
  });

  return {
    surface,
    prompt: (await prompt.textContent())?.trim() ?? '',
    answerKind,
    promptFont: styles.font,
    promptColor: styles.color,
    boxSizing: styles.boxSizing,
  };
}

export function writeFingerprint(fp: CardFingerprint): void {
  mkdirSync(dirname(PARITY_FILE), { recursive: true });
  writeFileSync(PARITY_FILE, JSON.stringify(fp, null, 2));
}

/**
 * Answers whatever surface the card is showing.
 *
 * Every item type is handled because the seeded topic contains several and the
 * scheduler decides which comes up — a spec that only knew how to type into a
 * textbox would fail on a recognition item for no interesting reason.
 */
export async function answerCard(page: Page, text = 'a lock with an expiry'): Promise<string> {
  const radios = page.locator('input[type="radio"][name="answer"]');
  if (await radios.count() > 0) {
    // The label wraps the input, so clicking the label is what a person does.
    await page.locator('label.choice').first().click();
    return 'radio';
  }

  const numeric = page.locator('input#numeric-answer');
  if (await numeric.count() > 0) {
    await numeric.fill('42');
    return 'number';
  }

  const box = page.getByLabel('Your answer');
  await box.fill(text);
  return 'text';
}

/**
 * Taps a confidence rating.
 *
 * **Required before the web session will accept an answer, and never
 * pre-selected** — a default would silently become data, and how often
 * "certain" was actually right is one of the numbers the whole pilot exists to
 * measure (plan.md §3.6). The extension asks the same question *after* the
 * verdict instead, so the wording differs and this helper takes both.
 */
export async function tapConfidence(
  page: Page,
  rating: 'Guessing' | 'Fairly sure' | 'Certain' = 'Fairly sure',
): Promise<void> {
  await page.getByText(rating, { exact: true }).click();
}
