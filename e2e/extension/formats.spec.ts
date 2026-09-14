import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { APIRequestContext, Page } from '@playwright/test';
import { API } from '../api.js';
import { expect, test } from './fixtures.js';

/**
 * The formats a popup is allowed to ask, and the two it is not (E2E-008).
 *
 * `e2e/web/formats.spec.ts` is the other half of this task: it walks a session
 * and proves every card renders its own answer surface. This file asks the
 * narrower question the extension actually raises — **which** of those formats
 * may reach the popup at all, and does each one still draw its own surface
 * once it gets there, in a card 344px wide.
 *
 * The subset is not a detail, it is the feature. `/due` is the extension's
 * queue and nothing else's, so `due.controller.ts` pins the surface to
 * `'extension'` server-side rather than reading it from a header a client could
 * get wrong; that applies `popupEligible()`, which excludes `codeEditor` (two
 * to four minutes) and `orderLines` (a drag that needs a pointer and room to
 * drop) — both T-089. What is left — `clozeCode`, `hotspotLine`, `numeric` —
 * is the whole of what a card at a traffic light may ask.
 *
 * So the **absence** asserted below is a product guarantee, not a gap in the
 * spec. Its failure mode is also the quietest in the product: a four-minute
 * question in a popup is not a slightly worse card, it is a card that gets
 * dismissed, and three dismissals in a row stop the extension for the day
 * (`lib/schedule.ts`) — one badly chosen item costs the rest of that day's
 * retrieval, which is the thing the pilot measures.
 *
 * Every format that does render is screenshotted at the popup's own width and
 * attached to the report, the way the web half does, so `pnpm e2e:report` is a
 * contact sheet of the small surface too. That matters more here than on the
 * web: a 344px card screenshotted at 1280 is a picture of a layout no learner
 * ever sees (T-130).
 */

/**
 * What each popup-eligible format must put on screen.
 *
 * An answer format falling through to the generic text box is the exact
 * regression T-118 shipped (`numeric` half-built, a field nothing read), and it
 * is *more* likely here than on the web: the extension is its own origin with
 * its own stylesheet entry, and T-126 was already that bug once.
 */
const SURFACE: Record<string, string> = {
  clozeCode: '.cloze__hole',
  hotspotLine: '.hotspot__grid',
  numeric: '#numeric-answer',
  // Allowed here since T-170. It was refused for being "a drag that needs a
  // pointer and room to drop", and both halves stopped being true: the panel
  // replaced a 380x300 popup, and `OrderLines` has never dragged — T-114 built
  // it with up/down buttons, each clearing a 44px tap target, because HTML5
  // drag does not fire on touch at all.
  orderLines: '.order__line',
};

/**
 * What the panel still refuses (T-089, narrowed by T-170).
 *
 * `codeEditor` alone now, and it is excluded twice over: by the panel's own
 * list and by `REVIEW_INELIGIBLE_KINDS`, which bars it from every review queue
 * on any surface (T-088). Its concept is taught, not held out and overdue —
 * every condition `findDueCards` asks for — so its absence is the rule working,
 * not the fixture being thin.
 */
const NEVER_IN_A_PANEL = ['codeEditor'] as const;

const ARTIFACTS = fileURLToPath(new URL('../.artifacts/formats-popup', import.meta.url));

interface FormatFixture {
  webSessionToken: string;
  kinds: string[];
  cards: { slug: string; prompt: string; itemId: string }[];
}

/** Written by `pnpm seed:formats:showcase`, which global-setup runs. One card
 *  per concept, every one of them overdue — see `seedFormatShowcase.ts` for why
 *  one-per-concept is what makes "see every format" a fact rather than a draw. */
function loadFixture(): FormatFixture {
  const path = fileURLToPath(new URL('../format-user.json', import.meta.url));
  const fixture = JSON.parse(readFileSync(path, 'utf8')) as FormatFixture;
  if (!fixture.cards.every((c) => c.itemId)) {
    throw new Error('e2e/format-user.json has no itemIds — re-run `pnpm seed:formats:showcase`.');
  }
  return fixture;
}

/**
 * A bearer token for the **showcase** learner.
 *
 * `e2e/api.ts`'s `signIn`/`mintExtensionToken` act on `dev@learnos.local`,
 * whose topic puts all five formats on one concept — precisely the arrangement
 * that cannot show them all, since the scheduler serves one item per due
 * concept (`seedFormatShowcase.ts`). So this mints against the showcase user's
 * own web session, through the same route the web app's Connect screen calls
 * (T-034), rather than reaching into the database for a token the product would
 * never issue.
 *
 * The cookie is passed as a header because this context has never signed in as
 * anybody, so nothing in its jar can collide with it.
 */
async function showcaseToken(request: APIRequestContext, fixture: FormatFixture): Promise<string> {
  const res = await request.post(`${API}/auth/extension-token`, {
    headers: { cookie: `learnos_session=${fixture.webSessionToken}` },
  });
  if (!res.ok()) {
    throw new Error(
      `extension-token for the showcase user failed (${res.status()}): ${await res.text()} — ` +
        'did `pnpm seed:formats:showcase` run, and is e2e/format-user.json current?',
    );
  }
  return ((await res.json()) as { token: string }).token;
}

interface DueItem {
  itemId: string;
  prompt: string;
  blocks?: { slot: string; kind: string }[];
}

async function fetchDue(request: APIRequestContext, token: string, limit = 50): Promise<DueItem[]> {
  const res = await request.get(`${API}/due?limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok()) throw new Error(`GET /due failed (${res.status()}): ${await res.text()}`);
  return ((await res.json()) as { items: DueItem[] }).items;
}

/** The answer block's kind, or `plain` for an item that has none — the four
 *  blockless types, and every item generated before blocks existed. */
function answerKindOfItem(item: DueItem): string {
  return item.blocks?.find((b) => b.slot === 'answer')?.kind ?? 'plain';
}

/** Everything due again, including whatever a previous step answered away.
 *  Same containment as `/due`: the caller's own rows only. */
async function dueNow(request: APIRequestContext, token: string): Promise<void> {
  const res = await request.post(`${API}/dev/due-now`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { count: 50 },
  });
  expect(res.ok(), `POST /dev/due-now failed: ${res.status()}`).toBe(true);
}

/**
 * Answers one item away, so its card leaves the queue.
 *
 * A graded answer reschedules (`recordReview`'s `shouldSchedule`); a dismiss or
 * a snooze does not — both record the event and deliberately never move the
 * schedule — which is why this posts a real response.
 *
 * The response is deliberately wrong. Nothing here asserts a verdict: the point
 * is only to empty the queue, and a spec that depended on being *right* would
 * break the day a seeded answer key changed.
 */
async function answerAway(request: APIRequestContext, token: string, itemId: string): Promise<void> {
  const res = await request.post(`${API}/reviews`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { itemId, response: 'x', confidence: null, surface: 'extension' },
  });
  expect(res.ok(), `POST /reviews failed for ${itemId}: ${res.status()}`).toBe(true);
}

/**
 * Leaves exactly one card in the whole queue, so the popup can only open on it.
 *
 * The popup asks `/due?limit=1` and takes the first row, and `findDueCards`
 * orders by `due` — which the showcase seeds identically across all fourteen
 * concepts, so *which* card a popup opens on is otherwise whatever Postgres
 * felt like returning that second.
 *
 * **Why it clears `orderLines` and `codeEditor` too, which `/due` never
 * lists.** `getDueItems` applies the LIMIT to the due *cards* and only then
 * filters the *items* by `popupEligible()`, so a due card whose only item is
 * ineligible consumes the one row the popup asked for and the response comes
 * back empty. Leaving those two behind therefore does not merely make the walk
 * flaky — it makes the popup say "nothing due right now" while an answerable
 * card is waiting, which is a real bug and is written up as T-169, not a
 * quirk of this fixture. Their ids come from the seed file because no API
 * exposes them: `popupEligible()` hides them from `/due` and `reviewEligible()`
 * hides `codeEditor` from every review queue there is.
 */
async function leaveOnly(
  request: APIRequestContext,
  token: string,
  fixture: FormatFixture,
  keepSlug: string,
): Promise<void> {
  await dueNow(request, token);

  for (const card of fixture.cards) {
    if (card.slug === keepSlug) continue;
    await answerAway(request, token, card.itemId);
  }

  const keep = fixture.cards.find((c) => c.slug === keepSlug);
  // Proof the queue really is down to one, rather than a hope that it is —
  // and at `limit=1`, which is the request the popup itself makes.
  expect((await fetchDue(request, token, 50)).map((i) => i.prompt)).toEqual([keep?.prompt]);
  expect((await fetchDue(request, token, 1)).map((i) => i.prompt)).toEqual([keep?.prompt]);
}

/** The options page, the way a learner uses it — pasted, verified against `/me`
 *  before it is stored, and the account it belongs to shown back. */
async function connect(page: Page, extensionId: string, token: string): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.getByLabel(/extension token/i).fill(token);
  await page.getByRole('button', { name: /^connect$/i }).click();
  // Not the word "connected" — the *address*, which only a round trip to `/me`
  // can produce, and which also proves this popup belongs to the showcase
  // learner rather than to dev@learnos.local.
  await expect(page.getByText('e2e-formats@learnos.local')).toBeVisible({ timeout: 30_000 });
}

test('the popup queue offers every format a popup can answer, and neither of the two it cannot', async ({
  request,
}) => {
  const fixture = loadFixture();
  const token = await showcaseToken(request, fixture);
  await dueNow(request, token);

  // Every showcase concept is overdue and carries exactly one item, so a single
  // `/due` call is the complete set of what this learner's popup could ever be
  // offered — which is what makes the absence below mean something.
  // `cardActions.spec.ts` asserts the same rule against the dev user, where
  // five formats share one concept and only one can surface per request: that
  // test can only ever say "not this draw". This one says "not in a response
  // that contains every other concept in the topic".
  const offered = await fetchDue(request, token);
  const kinds = offered.map(answerKindOfItem);

  for (const kind of Object.keys(SURFACE)) {
    expect(kinds, `${kind} is popup-eligible and must be offered`).toContain(kind);
  }

  for (const kind of NEVER_IN_A_PANEL) {
    expect(kinds, `${kind} must never reach the popup (T-089)`).not.toContain(kind);
  }

  // The rule is "too slow or too large", not "has blocks" — the nine
  // content-block cards carry no answer block at all and must still come
  // through, or the extension would go quiet for every topic generated before
  // blocks existed (`isPopupEligible`'s null case).
  expect(kinds.filter((k) => k === 'plain').length).toBeGreaterThan(0);

  // One item per due concept (`getDueItems` picks one from each pool), so the
  // count is the number of eligible concepts: all fourteen bar the two above.
  expect(offered.length).toBe(fixture.kinds.length - NEVER_IN_A_PANEL.length);
});

test('each popup-eligible format draws its own answer surface in the popup', async ({
  context,
  extensionId,
  request,
}) => {
  // Three popup opens, each preceded by emptying the queue around it. Slower
  // than one open, and the alternative is asserting on whichever card Postgres
  // happened to hand back first.
  test.slow();

  const fixture = loadFixture();
  const token = await showcaseToken(request, fixture);
  mkdirSync(ARTIFACTS, { recursive: true });

  const options = await context.newPage();
  await connect(options, extensionId, token);
  await options.close();

  const missingSurface: string[] = [];
  const overflowed: string[] = [];

  for (const slug of Object.keys(SURFACE)) {
    const card = fixture.cards.find((c) => c.slug === slug);
    expect(card, `${slug} is not in the showcase fixture`).toBeTruthy();
    if (!card) continue;

    await leaveOnly(request, token, fixture, slug);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    // Opening the popup asks `/due` itself rather than rendering only what the
    // worker left behind (T-129), so this is the real queue — not a fixture
    // pushed into extension storage to make a component render.
    await expect(popup.locator('.question__prompt')).toBeVisible({ timeout: 30_000 });
    await expect(popup.locator('.question__prompt')).toHaveText(card.prompt);

    if (!(await popup.locator(SURFACE[slug]).first().isVisible().catch(() => false))) {
      missingSurface.push(`${slug} (expected ${SURFACE[slug]})`);
    }

    /**
     * The card has to fit the card.
     *
     * Chrome fixes the popup's width (`.card` is 344px in
     * `extension/src/entrypoints/base.scss`) and gives the learner no way to
     * scroll it sideways, so anything wider than that is simply not on screen —
     * silently, with every text and role assertion still passing. A listing that
     * legitimately runs long scrolls inside its own `.code__scroll`, which
     * leaves `.card`'s own scrollWidth alone; a block that overflows the card
     * itself is the T-146/ClozeCode class of bug the web half found three of.
     */
    const box = await popup.locator('.card').evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
    }));
    if (box.scroll > box.client + 1) {
      overflowed.push(`${slug} (${box.scroll}px inside a ${box.client}px card)`);
    }

    // The card element, not the page: the page is Playwright's 460px window and
    // a screenshot of that is mostly window. This is what a learner sees.
    const file = `${ARTIFACTS}/${slug}.png`;
    await popup.locator('.card').screenshot({ path: file });
    await test.info().attach(`popup: ${slug}`, { path: file, contentType: 'image/png' });

    await popup.close();
  }

  expect(missingSurface, 'formats that fell through to the generic text box').toEqual([]);
  expect(overflowed, 'formats wider than the popup can show').toEqual([]);
});

test('a due codeEditor is refused, not merely unlucky', async ({
  context,
  extensionId,
  request,
}) => {
  const fixture = loadFixture();
  const token = await showcaseToken(request, fixture);
  await dueNow(request, token);

  // Answer away everything *except* the two excluded formats. If the filter
  // were ever dropped, the popup would have nothing else left to open on and
  // would have to show one of them — which turns a passive absence into a queue
  // where the bug, had it existed, is the only thing that could render.
  for (const card of fixture.cards) {
    if ((NEVER_IN_A_PANEL as readonly string[]).includes(card.slug)) continue;
    await answerAway(request, token, card.itemId);
  }
  expect(await fetchDue(request, token, 50)).toEqual([]);

  const options = await context.newPage();
  await connect(options, extensionId, token);
  await options.close();

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // "Nothing due right now" is the correct answer here, and it is the whole
  // assertion: the concept is not skipped, it waits for the next web session
  // instead (`due.service.ts`) — this rule decides *where* a question is asked,
  // never whether. (It is also the one arrangement in which that sentence is
  // honest; T-169 is about the popup saying it when eligible cards *are* due.)
  await expect(popup.getByText(/nothing due right now/i)).toBeVisible({ timeout: 30_000 });
  await expect(popup.locator('.question__prompt')).toHaveCount(0);

  for (const slug of NEVER_IN_A_PANEL) {
    const card = fixture.cards.find((c) => c.slug === slug);
    await expect(popup.getByText(card?.prompt ?? slug)).toHaveCount(0);
  }

  await test.info().attach('popup: nothing a popup can answer', {
    body: await popup.screenshot(),
    contentType: 'image/png',
  });
});
