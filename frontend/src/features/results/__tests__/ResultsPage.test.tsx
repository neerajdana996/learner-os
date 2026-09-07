import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ResultsResponse } from '@learnos/shared';
import { makeStore } from '../../../store';
import ResultsPage from '../pages/ResultsPage';

const topicId = '11111111-1111-4111-8111-111111111111';
const id = (n: number) => `${n}${n}${n}${n}${n}${n}${n}${n}-2222-4222-8222-222222222222`;

let results: ResultsResponse;

const base = (): ResultsResponse => ({
  topicId,
  topicTitle: 'Distributed systems',
  taught: 0.78,
  heldOut: 0.31,
  calibrationGap: 0.25,
  concepts: [
    { conceptId: id(1), title: 'Leases', heldOut: false, score: 0.9 },
    { conceptId: id(2), title: 'Vector clocks', heldOut: false, score: 0.2 },
    { conceptId: id(3), title: 'Quorums', heldOut: true, score: 0.3 },
    { conceptId: id(4), title: 'Backpressure', heldOut: false, score: null },
  ],
});

beforeEach(() => {
  results = base();
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } }),
  ));
});

afterEach(() => vi.unstubAllGlobals());

function mount() {
  render(
    <Provider store={makeStore()}>
      <MemoryRouter initialEntries={[`/results/${topicId}`]}>
        <Routes>
          <Route path="/results/:topicId" element={<ResultsPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
}

describe('ResultsPage', () => {
  it('leads with taught against held-out, because that is the claim', async () => {
    // "You remembered 78%" means little alone — people improve on their own.
    mount();

    expect(await screen.findByText('78%')).toBeInTheDocument();
    expect(screen.getByText('31%')).toBeInTheDocument();
  });

  it('splits what stuck from what did not', async () => {
    mount();

    await screen.findByText('What stuck');
    expect(screen.getByText('What didn’t')).toBeInTheDocument();
    expect(screen.getByText('Leases')).toBeInTheDocument();
    expect(screen.getByText('Vector clocks')).toBeInTheDocument();
  });

  it('shows the held-out concepts, and says they were held back on purpose', async () => {
    // Withheld during the experiment (T-010); revealing them afterwards is the
    // learner's own result, not a leak.
    mount();

    expect(await screen.findByText('Quorums')).toBeInTheDocument();
    expect(screen.getByText('never taught')).toBeInTheDocument();
    expect(screen.getByText(/yours to learn now/i)).toBeInTheDocument();
  });

  it('never lets a taught concept vanish just because it was not tested', async () => {
    // Found by this test: with only "stuck" and "didn't" buckets, a taught
    // concept with no score appeared in neither and disappeared from the page,
    // which reads as though it was never taught at all.
    mount();

    expect(await screen.findByText('Not asked this time')).toBeInTheDocument();
    expect(screen.getByText('Backpressure')).toBeInTheDocument();
  });

  it('leaves an unasked concept blank, not 0%', async () => {
    mount();

    expect(await screen.findByTitle('Not asked on the test')).toBeInTheDocument();
  });

  it('accounts for every concept exactly once', async () => {
    // The real guarantee: four concepts in, four rows out. A learner should be
    // able to find everything they were taught somewhere on this page.
    mount();

    await screen.findByText('Leases');
    for (const title of ['Leases', 'Vector clocks', 'Backpressure', 'Quorums']) {
      expect(screen.getAllByText(title)).toHaveLength(1);
    }
  });

  it('names overconfidence without scolding', async () => {
    mount();
    expect(await screen.findByText(/surer than you turned out to be/i)).toBeInTheDocument();
  });

  it('says the opposite thing when the learner underrated themselves', async () => {
    results = { ...base(), calibrationGap: -0.3 };
    mount();

    expect(await screen.findByText(/knew more than you thought/i)).toBeInTheDocument();
  });

  it('treats well-calibrated as the plain good outcome', async () => {
    results = { ...base(), calibrationGap: 0.02 };
    mount();

    expect(await screen.findByText(/tracked what you actually knew/i)).toBeInTheDocument();
  });

  it('describes the measurement that happened, promising no second one', async () => {
    // plan.md dropped the Day-45 test on 2026-09-06, and nothing creates one —
    // so a "we'll check again" line was a promise to every learner that the
    // product could never keep.
    mount();

    expect(await screen.findByText(/twenty-three days after the last session/i)).toBeInTheDocument();
    expect(screen.queryByText(/check once more/i)).toBeNull();
  });

  it('says there is nothing yet rather than showing a page of zeros', async () => {
    // Before the test, zeros would read as a catastrophic result.
    results = { ...base(), taught: null, heldOut: null, calibrationGap: null };
    mount();

    expect(await screen.findByText(/Nothing to show yet/i)).toBeInTheDocument();
    expect(screen.queryByText('0%')).toBeNull();
  });
});
