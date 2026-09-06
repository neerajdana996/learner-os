import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { TestNext } from '@learnos/shared';
import { makeStore } from '../../../store';
import TestPage from '../pages/TestPage';

const id = '11111111-1111-4111-8111-111111111111';
const firstId = '22222222-2222-4222-8222-222222222222';
const secondId = '33333333-3333-4333-8333-333333333333';
let current: TestNext;
let failAnswer: boolean;
let posted: unknown[];
const scores = { overall: .8, taught: .9, heldOut: .2, transfer: .75, calibrationGap: .1, perConcept: {} };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => {
  posted = []; failAnswer = false;
  current = { testId: id, done: false, completed: false, item: { itemId: firstId, conceptId: id, type: 'recall', prompt: 'First cold question' },
    progress: { answered: 7, total: 25 }, estimatedSeconds: 900 };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const req = input as Request;
    const path = new URL(req.url).pathname;
    if (path.endsWith('/next')) return response(current);
    if (path.endsWith('/answer')) {
      posted.push(await req.json());
      if (failAnswer) return response({ error: 'unavailable' }, 503);
      current = { ...current, item: { ...current.item!, itemId: secondId, prompt: 'Second cold question' }, progress: { answered: 8, total: 25 } };
      return response(current);
    }
    if (path.endsWith('/complete')) { current = { ...current, completed: true, scores }; return response(scores); }
    throw new Error(`Unexpected request: ${path}`);
  }));
});
afterEach(() => vi.unstubAllGlobals());
function mount() {
  const store = makeStore();
  render(<Provider store={store}><MemoryRouter initialEntries={[`/tests/${id}`]}>
    <Routes><Route path="/tests/:testId" element={<TestPage />} /></Routes>
  </MemoryRouter></Provider>);
  return store;
}
describe('cold test page', () => {
  it('resumes server progress, requires confidence and resets the draft for the next question', async () => {
    const user = userEvent.setup();
    const store = mount();
    await screen.findByRole('heading', { name: 'First cold question' });
    expect(screen.getByText(/8 of 25/)).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Your answer' }), 'remembered');
    expect(screen.getByRole('button', { name: 'Save answer' })).toBeDisabled();
    await user.click(screen.getByText('Certain'));
    await user.click(screen.getByRole('button', { name: 'Save answer' }));
    await screen.findByRole('heading', { name: 'Second cold question' });
    expect(posted[0]).toMatchObject({ itemId: firstId, response: 'remembered', confidence: 'sure' });
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(store.getState().testDraft.confidence).toBeNull();
    expect(screen.queryByText('Correct.')).not.toBeInTheDocument();
  });
  it('preserves a failed answer and retries the same item and confidence', async () => {
    const user = userEvent.setup();
    failAnswer = true;
    mount();
    await screen.findByRole('heading', { name: 'First cold question' });
    await user.type(screen.getByRole('textbox'), 'keep this answer');
    await user.click(screen.getByText('Fairly sure'));
    await user.click(screen.getByRole('button', { name: 'Save answer' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('textbox')).toHaveValue('keep this answer');
    failAnswer = false;
    await user.click(screen.getByRole('button', { name: 'Save answer' }));
    await screen.findByRole('heading', { name: 'Second cold question' });
    expect(posted).toHaveLength(2);
    for (const body of posted) expect(body).toMatchObject({ itemId: firstId, response: 'keep this answer', confidence: 'think' });
  });
  it('shows server scores only after completion', async () => {
    const user = userEvent.setup();
    current = { ...current, item: null, done: true, progress: { answered: 25, total: 25 } };
    mount();
    await screen.findByRole('heading', { name: 'Every answer is saved' });
    expect(screen.queryByText('80%')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Finish and see results' }));
    await screen.findByRole('heading', { name: 'Your recall check is complete' });
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('20%')).toBeInTheDocument();
  });
  it('sends I don’t know as an explicit null response with a confidence rating', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('heading', { name: 'First cold question' });
    expect(screen.getByRole('button', { name: 'I don’t know' })).toBeDisabled();
    await user.click(screen.getByText('Guessing'));
    await user.click(screen.getByRole('button', { name: 'I don’t know' }));
    await waitFor(() => expect(posted[0]).toMatchObject({ response: null, confidence: 'guess' }));
  });
});
