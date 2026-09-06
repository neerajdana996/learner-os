import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { makeStore } from '../../../store';
import SessionPage from '../pages/SessionPage';

/**
 * T-073. `GET /session` has always returned `dueReviews`; the screen counted
 * them in its own header — "then 2 reviews" — and never asked a single one.
 */
const fetchMock = vi.fn();

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

const concept = (n: number) => ({
  conceptId: `1111111${n}-1111-4111-8111-111111111111`,
  title: `Concept ${n}`,
  teachMode: 'example_first' as const,
  tryFirstPrompt: null,
  explanationShort: `Short ${n}.`,
  explanationLong: `Long ${n}, with more detail.`,
  corrections: [],
  item: {
    itemId: `aaaaaaa${n}-1111-4111-8111-111111111111`,
    conceptId: `1111111${n}-1111-4111-8111-111111111111`,
    type: 'recall' as const,
    prompt: `New question ${n}`,
  },
});

const review = (n: number) => ({
  itemId: `bbbbbbb${n}-1111-4111-8111-111111111111`,
  conceptId: `2222222${n}-1111-4111-8111-111111111111`,
  type: 'recall' as const,
  prompt: `Review question ${n}`,
});

/** Every POST /reviews body the page sent, in order. */
const posted: Record<string, unknown>[] = [];

/** RTK Query's fetchBaseQuery calls `fetch(request)` with a single Request
 *  object, so the body is on the request rather than in an init argument. */
async function bodyOf(input: RequestInfo | URL, init?: RequestInit): Promise<Record<string, unknown>> {
  if (init?.body) return JSON.parse(String(init.body));
  return JSON.parse(await (input as Request).clone().text());
}

function server(session: { newConcepts: unknown[]; dueReviews: unknown[]; completedToday?: boolean }) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.includes('/session/complete')) return json({ completedToday: true, taught: 0 });
    if (url.includes('/session')) return json({ completedToday: false, ...session });
    if (url.includes('/reviews')) {
      posted.push(await bodyOf(input, init));
      return json({ correct: true, feedback: 'Right.', conceptId: 'x' });
    }
    return json({});
  });
}

function renderPage() {
  return render(
    <Provider store={makeStore()}>
      <MemoryRouter>
        <SessionPage />
      </MemoryRouter>
    </Provider>,
  );
}

/** Answer whatever question is on screen: type, rate confidence, check, next. */
async function answerCurrent(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Your answer'), 'an answer');
  await user.click(screen.getByText('Fairly sure'));
  await user.click(screen.getByRole('button', { name: 'Check' }));
  await user.click(await screen.findByRole('button', { name: 'Next' }));
}

beforeEach(() => {
  posted.length = 0;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('session queue', () => {
  it('asks the new concepts and then every due review', async () => {
    const user = userEvent.setup();
    server({ newConcepts: [concept(1), concept(2)], dueReviews: [review(1), review(2)] });
    renderPage();

    expect(await screen.findByText(/Concept 1 of 2 · then 2 reviews/)).toBeInTheDocument();
    await answerCurrent(user);
    await answerCurrent(user);

    // The reviews used to be skipped entirely at this point.
    expect(await screen.findByText('Review 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('From an earlier day')).toBeInTheDocument();
    await answerCurrent(user);
    expect(await screen.findByText('Review 2 of 2')).toBeInTheDocument();
    await answerCurrent(user);

    expect(await screen.findByText('That’s today done')).toBeInTheDocument();

    // Four questions asked, in order, all as `web`.
    expect(posted).toHaveLength(4);
    expect(posted.map((p) => p.itemId)).toEqual([
      concept(1).item.itemId,
      concept(2).item.itemId,
      review(1).itemId,
      review(2).itemId,
    ]);
    expect(posted.every((p) => p.surface === 'web')).toBe(true);
  });

  it('runs the reviews when there is nothing new to teach', async () => {
    const user = userEvent.setup();
    server({ newConcepts: [], dueReviews: [review(1)] });
    renderPage();

    // This case used to render "Nothing due today" over a queue of real work.
    expect(await screen.findByText('Review 1 of 1')).toBeInTheDocument();
    await answerCurrent(user);

    expect(await screen.findByText('That’s today done')).toBeInTheDocument();
    expect(posted).toHaveLength(1);
  });

  it('counts what was answered, not what was offered', async () => {
    const user = userEvent.setup();
    server({ newConcepts: [concept(1)], dueReviews: [review(1), review(2)] });
    renderPage();

    await answerCurrent(user);
    await answerCurrent(user); // first review only
    await user.click(await screen.findByRole('button', { name: 'Skip this one' }));

    const summary = await screen.findByText('That’s today done');
    expect(summary).toBeInTheDocument();
    // 1 concept locked in, 2 reviews reached — the skip is one of them, and it
    // was recorded rather than dropped.
    expect(screen.getByText('reviews done').previousSibling).toHaveTextContent('2');
    expect(screen.getByText('locked in').previousSibling).toHaveTextContent('1');
    expect(posted).toHaveLength(3);
    expect(posted[2]).toMatchObject({ response: null, confidence: null });
  });

  it('says nothing is due only when nothing is', async () => {
    server({ newConcepts: [], dueReviews: [] });
    renderPage();

    expect(await screen.findByText('Nothing due today')).toBeInTheDocument();
  });
});
