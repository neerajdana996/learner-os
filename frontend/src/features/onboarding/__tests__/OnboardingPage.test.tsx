/**
 * T-091 — the learner picks the language, not the model.
 *
 * Asserted on the request body rather than on the draft, because the thing that
 * matters is what reaches `POST /topics`: "doesn't matter" has to arrive as an
 * *absent* field, not an empty string. The two are different rows — null is what
 * the topic profile (T-092) is allowed to infer into, and `''` would fail
 * `TopicCreateSchema` and 400 the whole build.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { makeStore } from '../../../store';
import { draftChanged } from '../onboardingSlice';
import OnboardingPage from '../pages/OnboardingPage';

const fetchMock = vi.fn();

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

/** Bodies of every POST /topics the page sent. */
const created: Record<string, unknown>[] = [];

async function bodyOf(input: RequestInfo | URL, init?: RequestInit): Promise<Record<string, unknown>> {
  if (init?.body) return JSON.parse(String(init.body));
  return JSON.parse(await (input as Request).clone().text());
}

function server() {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const method = (init?.method ?? (input as Request).method ?? 'GET').toUpperCase();
    if (url.includes('/topics') && method === 'POST') {
      created.push(await bodyOf(input, init));
      return json({ topicId: 'topic-1', status: 'generating' }, 202);
    }
    // The wait screen polls this once the topic exists; leave it generating so
    // the test never navigates away mid-assertion.
    if (url.includes('/topics/')) return json({ id: 'topic-1', status: 'generating', progress: null });
    if (url.includes('/users/me')) return json({ id: 'user-1' });
    return json({});
  });
}

/** Renders the page already on the topic step, with the earlier answers filled
 *  in — this test is about one field, not about walking the whole flow. */
function renderAtTopicStep() {
  const store = makeStore();
  store.dispatch(draftChanged({ step: 1, name: 'Neeraj', role: 'product', topic: 'Dynamic programming' }));
  render(
    <Provider store={store}>
      <MemoryRouter>
        <OnboardingPage />
      </MemoryRouter>
    </Provider>,
  );
  return store;
}

/** Topic step → budget → windows → build. */
async function submit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await user.click(screen.getByRole('button', { name: 'Build my map' }));
}

beforeEach(() => {
  created.length = 0;
  localStorage.clear();
  fetchMock.mockReset();
  server();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('onboarding — course length', () => {
  /**
   * Seven days of teaching, then silence, then the cold test on day 30
   * (plan.md §2, founder decision 2026-09-06). This is a bare constant in the
   * page with nothing else pointing at it, so a stray edit would quietly change
   * what ten pilot participants are asked to do — and the pacing that falls out
   * of it, since the planner divides the remaining map by the remaining days.
   */
  it('creates a seven-day course', async () => {
    const user = userEvent.setup();
    renderAtTopicStep();
    await submit(user);

    await vi.waitFor(() => expect(created).toHaveLength(1));
    const { startsAt, endsAt } = created[0] as { startsAt: string; endsAt: string };
    const days = (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 86_400_000;
    expect(days).toBe(7);
  });
});

describe('onboarding — language', () => {
  it('submits the language the learner picked', async () => {
    const user = userEvent.setup();
    renderAtTopicStep();

    await user.click(screen.getByRole('radio', { name: 'Python' }));
    await submit(user);

    await vi.waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ title: 'Dynamic programming', language: 'Python' });
  });

  it('submits no language at all when the learner says it doesn’t matter', async () => {
    const user = userEvent.setup();
    renderAtTopicStep();

    // Picked and then un-picked: the escape has to survive a change of mind,
    // not just be the untouched default.
    await user.click(screen.getByRole('radio', { name: 'Go' }));
    await user.click(screen.getByRole('radio', { name: /Doesn’t matter/ }));
    await submit(user);

    await vi.waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).not.toHaveProperty('language');
  });

  it('offers “doesn’t matter” as a selectable option, pre-selected', async () => {
    renderAtTopicStep();

    // A first-class answer, not a skip: it is in the same group as the
    // languages and it is what an untouched form means.
    expect(screen.getByRole('radio', { name: /Doesn’t matter/ })).toBeChecked();
  });
});
