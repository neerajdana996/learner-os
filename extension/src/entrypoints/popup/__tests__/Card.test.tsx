import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PublicItem } from '@learnos/shared';
import { Card } from '../Card';

const posted: Record<string, unknown>[] = [];
const onClose = vi.fn();

vi.mock('../../../lib/api', () => ({
  postReview: (answer: Record<string, unknown>) => {
    posted.push(answer);
    return Promise.resolve({ correct: answer.response === 1, gapDaysSinceLast: 9, feedback: 'Empty means it runs once.' });
  },
}));

vi.mock('../../../lib/storage', () => ({
  getPopState: () => Promise.resolve({ day: null, dailyCount: 0, lastShownAt: null, consecutiveDismissals: 0, backoffUntil: null }),
  setPopState: () => Promise.resolve(),
}));

const item: PublicItem = {
  itemId: '11111111-1111-4111-8111-111111111111',
  conceptId: '22222222-2222-4222-8222-222222222222',
  type: 'recognition',
  prompt: 'What does an empty dependency array mean?',
  options: ['Run after every render', 'Run once, after the first render', 'Never run', 'Run only on unmount'],
};

beforeEach(() => {
  posted.length = 0;
  onClose.mockReset();
});

describe('the twenty-second card', () => {
  it('sends the option index that was chosen', async () => {
    const user = userEvent.setup();
    render(<Card item={item} onClose={onClose} />);

    await user.click(screen.getByRole('radio', { name: /run once/i }));
    await user.click(screen.getByRole('button', { name: 'Answer' }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ itemId: item.itemId, response: 1, surface: 'extension' });
    expect(posted[0]).toHaveProperty('idempotencyKey');
    expect(posted[0]).toHaveProperty('latencyMs');
  });

  /**
   * "Nine days since you last saw this" is the product in one line — a right
   * answer after nine days is the thing being measured; the same answer after
   * ten minutes is not.
   */
  it('leads with the gap, not just the verdict', async () => {
    const user = userEvent.setup();
    render(<Card item={item} onClose={onClose} />);

    await user.click(screen.getByRole('radio', { name: /run once/i }));
    await user.click(screen.getByRole('button', { name: 'Answer' }));

    expect(await screen.findByText(/Right — 9 days since you last saw this/)).toBeInTheDocument();
    expect(screen.getByText(/Empty means it runs once/)).toBeInTheDocument();
  });

  it('marks a wrong answer wrong and still explains', async () => {
    const user = userEvent.setup();
    render(<Card item={item} onClose={onClose} />);

    await user.click(screen.getByRole('radio', { name: /never run/i }));
    await user.click(screen.getByRole('button', { name: 'Answer' }));

    expect(await screen.findByText(/Not this time/)).toBeInTheDocument();
    expect(screen.getByText(/Empty means it runs once/)).toBeInTheDocument();
  });

  it('will not send until something is chosen', () => {
    render(<Card item={item} onClose={onClose} />);
    expect(screen.getByRole('button', { name: 'Answer' })).toBeDisabled();
  });

  it('asks for confidence only after the answer, and never pre-selected', async () => {
    const user = userEvent.setup();
    render(<Card item={item} onClose={onClose} />);

    // Before: asking first would make it a hint.
    expect(screen.queryByRole('radio', { name: 'Certain' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /run once/i }));
    await user.click(screen.getByRole('button', { name: 'Answer' }));

    const certain = await screen.findByRole('radio', { name: 'Certain' });
    // A default would silently become data, and how often "certain" was right
    // is one of the numbers the pilot exists to measure.
    expect(certain).not.toBeChecked();
  });

  it('records confidence against the same event, not a second one', async () => {
    const user = userEvent.setup();
    render(<Card item={item} onClose={onClose} />);

    await user.click(screen.getByRole('radio', { name: /run once/i }));
    await user.click(screen.getByRole('button', { name: 'Answer' }));
    await user.click(await screen.findByRole('radio', { name: 'Certain' }));

    await waitFor(() => expect(posted).toHaveLength(2));
    // Same key: this updates the event just recorded. A fresh key would
    // schedule the card twice and corrupt a measurement.
    expect(posted[1]?.idempotencyKey).toBe(posted[0]?.idempotencyKey);
    expect(posted[1]).toMatchObject({ confidence: 'sure' });
  });

  it('snoozes without recording an answer', async () => {
    const user = userEvent.setup();
    render(<Card item={item} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Later' }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ snoozed: true, surface: 'extension' });
    expect(posted[0]?.correct).toBeUndefined();
    expect(onClose).toHaveBeenCalled();
  });

  it('dismisses without recording an answer', async () => {
    const user = userEvent.setup();
    render(<Card item={item} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ dismissed: true, surface: 'extension' });
    expect(onClose).toHaveBeenCalled();
  });

  it('carries no navigation, branding or score — it has one job', () => {
    render(<Card item={item} onClose={onClose} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText(/learnos/i)).not.toBeInTheDocument();
  });
});
