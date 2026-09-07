import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import type { AdminReport } from '@learnos/shared';
import { makeStore } from '../../../store';
import AdminPage from '../pages/AdminPage';

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const row = (over: Partial<AdminReport['rows'][number]> = {}): AdminReport['rows'][number] => ({
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'learner@example.com',
  topicId: '22222222-2222-4222-8222-222222222222',
  topicTitle: 'Distributed systems',
  retentionGain: 0.4,
  taughtDelta: 0.5,
  heldOutDelta: 0.1,
  transfer: 0.6,
  calibrationGapDelta: -0.2,
  extension: {
    shown: 10, answered: 6, snoozed: 1, dismissed: 2, closedNoAction: 1,
    answerRate: 0.6, medianLatencyMs: 5200,
  },
  teachMode: [],
  calibration: [{ bin: 0.8, predicted: 0.85, actual: 0.75, n: 4 }],
  ...over,
});

let report: AdminReport;
let status: number;

beforeEach(() => {
  status = 200;
  report = {
    rows: [row()],
    cohort: {
      n: { retentionGain: 1, transfer: 1, calibrationGapDelta: 1, answerRate: 1 },
      retentionGain: 0.4, transfer: 0.6, calibrationGapDelta: -0.2, answerRate: 0.6,
    },
  };
  vi.stubGlobal('fetch', vi.fn(async () =>
    status === 200 ? response(report) : response({ error: 'forbidden' }, status),
  ));
});

afterEach(() => vi.unstubAllGlobals());

function mount() {
  render(
    <Provider store={makeStore()}>
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>
    </Provider>,
  );
}

describe('AdminPage', () => {
  it('shows one row per participant and topic', async () => {
    mount();

    expect(await screen.findByText('learner@example.com')).toBeInTheDocument();
    expect(screen.getByText('Distributed systems')).toBeInTheDocument();
  });

  it('signs the gain, so an improvement reads as one', async () => {
    mount();

    // Two of them by design: the cohort mean and the one row it is a mean of.
    const signed = await screen.findAllByText('+0.40');
    expect(signed).toHaveLength(2);
  });

  it('signs a shrinking confidence gap negative, which is the improvement', async () => {
    // The one metric whose sign reads backwards from the others.
    mount();

    const shown = await screen.findAllByText('-0.20');
    expect(shown.length).toBeGreaterThanOrEqual(1);
  });

  it('shows a dash for a number that was never measured, not a zero', async () => {
    // A blank cell and a 0.00 cell are opposite findings: "no Day-45 test yet"
    // versus "they remembered nothing".
    report = { ...report, rows: [row({ transfer: null })] };
    mount();

    expect(await screen.findByTitle('Not measured')).toBeInTheDocument();
    expect(screen.queryByText('0.00')).toBeNull();
  });

  it('puts an n beside every cohort mean', async () => {
    // "0.4 across ten people" and "0.4 across one" are different claims.
    mount();

    const ns = await screen.findAllByText('n=1');
    expect(ns.length).toBeGreaterThanOrEqual(4);
  });

  it('draws predicted and actual as a pair, with the bin size', async () => {
    mount();

    expect(await screen.findByTitle('predicted 0.85')).toBeInTheDocument();
    expect(screen.getByTitle('actual 0.75')).toBeInTheDocument();
    expect(screen.getByText('n=4')).toBeInTheDocument();
  });

  it('says nothing to calibrate against rather than drawing an empty chart', async () => {
    report = { ...report, rows: [row({ calibration: [] })] };
    mount();

    expect(await screen.findByText(/nothing to calibrate against/i)).toBeInTheDocument();
  });

  it('explains a 403 instead of showing an empty dashboard', async () => {
    // The route existing is not the permission. A non-admin who reaches it
    // must be told why, not shown a blank table that looks like no data.
    status = 403;
    mount();

    expect(await screen.findByText(/limited to the addresses/i)).toBeInTheDocument();
  });

  it('links the CSV export per topic', async () => {
    mount();

    const link = await screen.findByRole('link', { name: 'CSV' });
    expect(link.getAttribute('href')).toContain('/admin/topics/22222222-2222-4222-8222-222222222222/reviews.csv');
  });
});
