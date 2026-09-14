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
  /**
   * The answer surface the card chose for this item's type.
   *
   * The block formats are listed because the dev topic carries one seeded item
   * per kind (`pnpm seed:formats`), so a popup or session can legitimately
   * serve a `clozeCode` card — and this helper returning `unknown` for it read
   * as a rendering failure when the card was in fact correct.
   */
  answerKind:
    | 'radio'
    | 'text'
    | 'textarea'
    | 'number'
    | 'cloze'
    | 'hotspot'
    | 'order'
    | 'editor'
    | 'unknown';
  promptFont: string;
  promptColor: string;
  boxSizing: string;
  /** The card's own background — `.teach__card`/`.teach__card--retrieval` on
   *  the web session, the popup's own root on the extension. A T-126-style
   *  "wrong box model" bug can leave fonts alone but still paint the design
   *  system's tokens onto the wrong surface, which font/box-sizing alone
   *  would miss. */
  backgroundColor: string;
  /** The answer surface's own border colour — `.field__input`,
   *  `.field__textarea`, or the first `.choice` for a recognition item. */
  answerBorderColor: string;
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
    // Block surfaces first: they replace the default control entirely, and a
    // `codeEditor` contains a textarea that would otherwise match below.
    if (document.querySelector('.cloze__hole')) return 'cloze' as const;
    if (document.querySelector('.hotspot__grid')) return 'hotspot' as const;
    if (document.querySelector('.order__line')) return 'order' as const;
    if (document.querySelector('.editor__area')) return 'editor' as const;
    if (document.querySelector('input[type="radio"][name="answer"]')) return 'radio' as const;
    if (document.querySelector('input#numeric-answer')) return 'number' as const;
    if (document.querySelector('textarea[aria-label="Your answer"]')) return 'textarea' as const;
    if (document.querySelector('input[aria-label="Your answer"]')) return 'text' as const;
    return 'unknown' as const;
  });

  const backgroundColor = await prompt.evaluate((el) => {
    // Walk up from the prompt to the first ancestor with a real (non-alpha-0)
    // background — the design system paints the card, not every wrapper.
    let node: Element | null = el;
    while (node) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
      node = node.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  });

  const answerBorderColor = await page.evaluate(() => {
    const el = document.querySelector('.field__input, .field__textarea, .choice');
    return el ? getComputedStyle(el).borderColor : '';
  });

  return {
    surface,
    prompt: (await prompt.textContent())?.trim() ?? '',
    answerKind,
    promptFont: styles.font,
    promptColor: styles.color,
    boxSizing: styles.boxSizing,
    backgroundColor,
    answerBorderColor,
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

  // ---- the block answer surfaces (T-086 → T-114, T-088)
  //
  // The dev topic carries one seeded item per kind (`pnpm seed:formats`), so
  // any surface drawing from its due queue can serve one of these. None of
  // them has a "Your answer" box, so without these branches the fallback below
  // throws on a card that is rendering perfectly well.
  //
  // What is filled in is deliberately not the right answer: these helpers
  // exist to get a verdict out of the server, and a spec that depended on
  // being *correct* would break whenever the seeded answer changed.
  const holes = page.locator('.cloze__hole');
  if (await holes.count() > 0) {
    for (let i = 0; i < (await holes.count()); i += 1) await holes.nth(i).fill('[]');
    return 'cloze';
  }

  const hotspot = page.locator('.hotspot__line');
  if (await hotspot.count() > 0) {
    await hotspot.first().click();
    return 'hotspot';
  }

  const editor = page.locator('.editor__area');
  if (await editor.count() > 0) {
    await editor.fill('function longest() { return 0; }');
    return 'editor';
  }

  // `orderLines` arrives in an order already, so submitting it untouched is a
  // real answer — usually a wrong one, which is fine.
  if (await page.locator('.order__line').count() > 0) return 'order';

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
