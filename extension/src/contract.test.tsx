/**
 * What the extension is not allowed to do (T-033).
 *
 * Two promises, both of which fail silently if broken:
 *
 * 1. **It never shows an answer.** Every question the extension asks is also a
 *    measurement, and a leaked answer key does not produce a visible bug — it
 *    produces a learner who scores well, which is exactly the outcome the pilot
 *    is trying to measure honestly. `due.test.ts` holds the server end of this;
 *    these hold the client end, so a regression on either side is caught.
 *
 * 2. **It talks to one origin.** An extension is a privileged context, and a
 *    fetch to anywhere but the API would be an exfiltration path out of a
 *    browser the learner trusts. The manifest is the real enforcement; this
 *    asserts the manifest, and then that no code path tries anyway.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing';
import { PublicItemSchema } from '@learnos/shared';
import config from '../wxt.config';
import { API_URL, apiFetch, flagItem, getMe, postReview } from './lib/api';
import { drain, writeQueue } from './lib/queue';
import { setPendingCard, setToken } from './lib/storage';
import { Popup } from './entrypoints/popup/Popup';

const fetchMock = vi.fn();

/** A `/due` item as the server sends it, with answer keys bolted on — the
 *  shape a regression on the server would produce. */
const LEAKY_ITEM = {
  itemId: '11111111-1111-4111-8111-111111111111',
  conceptId: '22222222-2222-4222-8222-222222222222',
  type: 'recognition',
  prompt: 'Which one is the lease?',
  options: ['A lock', 'A lock with an expiry', 'A queue', 'A clock'],
  // Deliberately not substrings of any legitimate option: an assertion that
  // passes because the leaked text happens to resemble a distractor proves
  // nothing.
  answerIndex: 1,
  answer: 'LEAKED_ANSWER',
  accept: ['LEAKED_ACCEPT'],
  rubric: 'LEAKED_RUBRIC',
};

beforeEach(() => {
  fakeBrowser.reset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ items: [] }), { headers: { 'Content-Type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the extension renders only the public shape', () => {
  it('strips answer keys off a card before it can reach the renderer', () => {
    // This is the guard on the projection itself: `.passthrough()` here, or a
    // field added to the schema, breaks this test and only this test.
    // Zod strips unknown keys, so the projection is enforced twice: once on the
    // server (`toPublicItem` builds the shape field by field) and once here.
    // Belt and braces on purpose — this is the one class of bug that looks like
    // success while it is happening.
    const parsed = PublicItemSchema.parse(LEAKY_ITEM);

    expect(parsed).not.toHaveProperty('answerIndex');
    expect(parsed).not.toHaveProperty('answer');
    expect(parsed).not.toHaveProperty('accept');
    expect(parsed).not.toHaveProperty('rubric');
    expect(parsed.options).toHaveLength(4); // still answerable
  });

  it('paints no field the renderer was not designed to paint', async () => {
    // **A second, independent defence, and the mutation test proves it.**
    // Bypassing the projection above (handing `Popup` the raw stored object)
    // does not make this fail — `QuestionCard` renders `prompt` and `options`
    // and nothing else, so an answer key reaching it is still not drawn.
    // That is worth having precisely because it does not depend on the parse:
    // the two guards fail independently, which is the point of having both.
    await setToken('tok_abc123');
    await setPendingCard(LEAKY_ITEM);

    render(<Popup />);

    await screen.findByText('Which one is the lease?');
    // All four options are on screen; nothing says which is right.
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(document.body.textContent).not.toContain('LEAKED_ANSWER');
    expect(document.body.textContent).not.toContain('LEAKED_ACCEPT');
    expect(document.body.textContent).not.toContain('LEAKED_RUBRIC');
    // Not merely invisible — absent. A value in the DOM is a value in the page
    // source, and "you cannot see it" is not a security property.
    expect(document.body.innerHTML).not.toContain('LEAKED');
  });

  it('shows nothing due rather than a card it cannot trust', async () => {
    // A stored card that fails to parse means the server changed shape. Better
    // to say nothing is due than to hand the renderer a half-understood item.
    await setToken('tok_abc123');
    await setPendingCard({ itemId: 'not-a-uuid', prompt: 'Suspicious' });

    render(<Popup />);

    expect(await screen.findByText(/Nothing due right now/)).toBeInTheDocument();
    expect(screen.queryByText('Suspicious')).toBeNull();
  });

  it('does not render a held-out or untaught concept, because it never receives one', async () => {
    // The filter is the server's — `findDueCards` requires `taughtAt` and
    // `heldOut = false`, asserted in due.test.ts. What matters here is that the
    // extension adds no *second* path to an item: the popup reads the card the
    // worker stored, or asks `/due` for one (T-129), and has no third source.
    await setToken('tok_abc123');

    render(<Popup />);

    await screen.findByText(/Nothing due right now/);
    // Exactly one request, and it is the due query.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${API_URL}/due?limit=1`);
  });
});

/**
 * WXT types `manifest` as an object, a promise, or a function, because it
 * allows all three. Ours is static — which is itself the property under test:
 * a manifest computed at build time could ask for a different origin than the
 * one reviewed here.
 */
function staticManifest() {
  const manifest = config.manifest;
  if (typeof manifest !== 'object' || manifest === null || 'then' in manifest) {
    throw new Error('the manifest must be a plain object, not computed');
  }
  return manifest;
}

describe('the extension talks to exactly one origin', () => {
  it('asks for one host permission, and it is the API', () => {
    // The manifest is the actual enforcement — a test that only drives the code
    // paths I remembered would miss the one I did not. `<all_urls>` here would
    // be both a lie about what this extension does and a much worse review.
    const manifest = staticManifest();
    const hosts = manifest.host_permissions ?? [];

    expect(hosts).toEqual([`${new URL(API_URL).origin}/*`]);
    expect(hosts).not.toContain('<all_urls>');
    expect(manifest.permissions).not.toContain('tabs');
  });

  it('reads nothing from the pages the learner is browsing', () => {
    // No content script and no host access to anything but the API: whatever is
    // in the other tab stays there.
    expect(staticManifest()).not.toHaveProperty('content_scripts');
  });

  it('sends every request to the API origin and nowhere else', async () => {
    await setToken('tok_abc123');

    // Every call is allowed to fail its response parse — the request has
    // already been made by then, and the URL is what is under test.
    await getMe().catch(() => {});
    await apiFetch('/due?limit=1');
    await postReview({
      itemId: '11111111-1111-4111-8111-111111111111',
      confidence: null,
      surface: 'extension',
      dismissed: true,
    }).catch(() => {});
    await flagItem('11111111-1111-4111-8111-111111111111').catch(() => {});

    expect(fetchMock).toHaveBeenCalled();
    for (const [url] of fetchMock.mock.calls) {
      expect(String(url).startsWith(`${API_URL}/`)).toBe(true);
    }
  });

  it('replays a queued answer to the API, not to wherever it was queued from', async () => {
    await setToken('tok_abc123');
    await writeQueue([
      {
        answer: {
          itemId: '11111111-1111-4111-8111-111111111111',
          confidence: null,
          surface: 'extension',
          response: 'a lease',
        },
        queuedAt: Date.now(),
        attempts: 0,
        nextAttemptAt: 0,
      },
    ]);

    await drain(async (answer) => {
      await postReview(answer);
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    for (const [url] of fetchMock.mock.calls) {
      expect(String(url).startsWith(`${API_URL}/`)).toBe(true);
    }
  });
});
