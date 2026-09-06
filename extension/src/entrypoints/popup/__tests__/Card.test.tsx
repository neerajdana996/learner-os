import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PublicItem } from '@learnos/shared';
import { fakeBrowser } from 'wxt/testing';
import { readQueue } from '../../../lib/queue';
import { Card } from '../Card';

const posted: Record<string, unknown>[] = [];
const onClose = vi.fn();

const flagged: string[] = [];

/**
 * Hoisted with the mock factory, which vitest lifts above every other statement
 * — a class declared normally is not yet initialised when the factory returns
 * it. It has to be a real class so `error instanceof ApiError` in `Card.send`
 * behaves the way it does in Chrome.
 */
const { ApiError } = vi.hoisted(() => ({
  ApiError: class ApiError extends Error {
    constructor(
      readonly status: number,
      readonly body: string,
    ) {
      super(`${status}: ${body}`);
      this.name = 'ApiError';
    }
  },
}));

/** Set by a test to make the next send fail. Null means the server answers. */
let failNext: Error | null = null;

/** What the server says the next sighting is. */
let nextDue: string | null = null;

vi.mock('../../../lib/api', () => ({
  ApiError,
  postReview: (answer: Record<string, unknown>) => {
    if (failNext) {
      const error = failNext;
      failNext = null;
      return Promise.reject(error);
    }
    posted.push(answer);
    return Promise.resolve({
      correct: answer.response === 1,
      gapDaysSinceLast: 9,
      feedback: 'Empty means it runs once.',
      due: nextDue,
    });
  },
  flagItem: (id: string) => {
    flagged.push(id);
    return Promise.resolve({ retired: false });
  },
}));

/** Mutable so a test can start the card from a state that is one refusal away
 *  from the backoff. */
let popState = { day: null, dailyCount: 0, lastShownAt: null, consecutiveDismissals: 0, backoffUntil: null } as {
  day: string | null;
  dailyCount: number;
  lastShownAt: number | null;
  consecutiveDismissals: number;
  backoffUntil: number | null;
};

vi.mock('../../../lib/storage', () => ({
  getPopState: () => Promise.resolve(popState),
  setPopState: (next: typeof popState) => {
    popState = next;
    return Promise.resolve();
  },
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
  flagged.length = 0;
  failNext = null;
  nextDue = null;
  popState = { day: null, dailyCount: 0, lastShownAt: null, consecutiveDismissals: 0, backoffUntil: null };
  fakeBrowser.reset();
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

  describe('reporting a bad question', () => {
    async function answerIt(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole('radio', { name: /run once/i }));
      await user.click(screen.getByRole('button', { name: 'Answer' }));
      await screen.findByText(/Right —/);
    }

    it('is offered only after the answer — that is when you can judge it', async () => {
      const user = userEvent.setup();
      render(<Card item={item} onClose={onClose} />);

      // Before answering, a hard question and a bad one look the same.
      expect(screen.queryByRole('button', { name: /report a bad question/i })).not.toBeInTheDocument();
      await answerIt(user);
      expect(screen.getByRole('button', { name: /report a bad question/i })).toBeInTheDocument();
    });

    it('reports the item, once', async () => {
      const user = userEvent.setup();
      render(<Card item={item} onClose={onClose} />);
      await answerIt(user);

      await user.click(screen.getByRole('button', { name: /report a bad question/i }));

      expect(await screen.findByText(/Reported/)).toBeInTheDocument();
      expect(flagged).toEqual([item.itemId]);
      // The count is not deduplicated per learner, so the control has to stop
      // one person filing three complaints with three taps.
      expect(screen.queryByRole('button', { name: /report a bad question/i })).not.toBeInTheDocument();
    });
  });

  it('carries no navigation, branding or score — it has one job', () => {
    render(<Card item={item} onClose={onClose} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText(/learnos/i)).not.toBeInTheDocument();
  });
});

describe('an answer given offline (T-031)', () => {
  it('keeps the answer instead of losing it', async () => {
    // Before the queue, this path told the learner their answer was gone — and
    // it was. A lost answer is a missing point on the retention curve that no
    // later session can reconstruct.
    const user = userEvent.setup();
    failNext = new Error('Failed to fetch');
    render(<Card item={item} onClose={onClose} />);

    await user.click(screen.getByRole('radio', { name: /Run once/ }));
    await user.click(screen.getByRole('button', { name: 'Answer' }));

    expect(await screen.findByText(/we’ll send this the moment you’re back/i)).toBeTruthy();
    const queued = await readQueue();
    expect(queued).toHaveLength(1);
    expect(queued[0]?.answer.response).toBe(1);
    expect(queued[0]?.answer.surface).toBe('extension');
  });

  it('shows no verdict, because there is no server to grade it', async () => {
    const user = userEvent.setup();
    failNext = new Error('Failed to fetch');
    render(<Card item={item} onClose={onClose} />);

    await user.click(screen.getByRole('radio', { name: /Run once/ }));
    await user.click(screen.getByRole('button', { name: 'Answer' }));

    await screen.findByText(/we’ll send this/i);
    expect(screen.queryByText('Right')).toBeNull();
    expect(screen.queryByText('Not this time')).toBeNull();
  });

  it('cannot be answered twice once it is queued', async () => {
    const user = userEvent.setup();
    failNext = new Error('Failed to fetch');
    render(<Card item={item} onClose={onClose} />);

    await user.click(screen.getByRole('radio', { name: /Run once/ }));
    await user.click(screen.getByRole('button', { name: 'Answer' }));

    await screen.findByText(/we’ll send this/i);
    expect(screen.getByRole('button', { name: 'Answer' }).hasAttribute('disabled')).toBe(true);
    expect(await readQueue()).toHaveLength(1);
  });

  it('does not queue an answer the server understood and refused', async () => {
    // A 400 will be refused identically in five minutes; queueing it would put
    // a permanent blocker at the head of a FIFO queue.
    const user = userEvent.setup();
    failNext = new ApiError(400, 'unknown item');
    render(<Card item={item} onClose={onClose} />);

    await user.click(screen.getByRole('radio', { name: /Run once/ }));
    await user.click(screen.getByRole('button', { name: 'Answer' }));

    await waitFor(async () => expect(await readQueue()).toHaveLength(0));
    expect(screen.queryByText(/we’ll send this/i)).toBeNull();
  });

  it('queues a 500, which is the server being briefly unavailable', async () => {
    const user = userEvent.setup();
    failNext = new ApiError(500, 'upstream timeout');
    render(<Card item={item} onClose={onClose} />);

    await user.click(screen.getByRole('radio', { name: /Run once/ }));
    await user.click(screen.getByRole('button', { name: 'Answer' }));

    await screen.findByText(/we’ll send this/i);
    expect(await readQueue()).toHaveLength(1);
  });
});

describe('the third refusal in a row (T-030)', () => {
  it('says why it is going quiet, instead of just going quiet', async () => {
    // Someone who thinks the extension broke uninstalls it. Someone told it
    // took the hint does not.
    const user = userEvent.setup();
    popState = { day: null, dailyCount: 3, lastShownAt: null, consecutiveDismissals: 2, backoffUntil: null };
    render(<Card item={item} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(await screen.findByText(/we’ll leave you alone until tomorrow/i)).toBeTruthy();
  });

  it('says nothing on the first two, which are not a pattern yet', async () => {
    const user = userEvent.setup();
    popState = { day: null, dailyCount: 1, lastShownAt: null, consecutiveDismissals: 0, backoffUntil: null };
    render(<Card item={item} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByText(/leave you alone until tomorrow/i)).toBeNull();
  });
});

describe('the design canvas states', () => {
  it('tells a wrong answer when the concept comes back', async () => {
    // A bare "not this time" leaves the learner unsure whether the concept is
    // now lost. Being wrong here is the mechanism working.
    const user = userEvent.setup();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    nextDue = tomorrow.toISOString();
    render(<Card item={item} onClose={onClose} />);

    await user.click(screen.getByRole('radio', { name: /Never run/ }));
    await user.click(screen.getByRole('button', { name: 'Answer' }));

    expect(await screen.findByText(/Not this time/)).toBeTruthy();
    expect(screen.getByText(/see this one again tomorrow/i)).toBeTruthy();
  });

  it('promises no return date on a right answer', async () => {
    const user = userEvent.setup();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    nextDue = tomorrow.toISOString();
    render(<Card item={item} onClose={onClose} />);

    await user.click(screen.getByRole('radio', { name: /Run once/ }));
    await user.click(screen.getByRole('button', { name: 'Answer' }));

    await screen.findByText(/Right/);
    expect(screen.queryByText(/see this one again/i)).toBeNull();
  });

  it('asks about confidence in the past tense, because the answer is already shown', async () => {
    // The shared component's default wording — "How sure are you?", "Required"
    // — belongs to the web session, which asks before the answer. Here it would
    // be asking about a moment that has passed.
    const user = userEvent.setup();
    render(<Card item={item} onClose={onClose} />);

    await user.click(screen.getByRole('radio', { name: /Run once/ }));
    await user.click(screen.getByRole('button', { name: 'Answer' }));

    expect(await screen.findByText(/how sure were you\?/i)).toBeTruthy();
    expect(screen.queryByText(/How sure are you\?/i)).toBeNull();
    expect(screen.queryByText(/^Required/)).toBeNull();
  });

  it('replaces the whole card when it backs off, rather than arguing with the ✕', async () => {
    const user = userEvent.setup();
    popState = { day: null, dailyCount: 3, lastShownAt: null, consecutiveDismissals: 2, backoffUntil: null };
    render(<Card item={item} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(await screen.findByText(/we’ll leave you alone until tomorrow/i)).toBeTruthy();
    // The question, the header and the way to dismiss it are all gone.
    expect(screen.queryByText('What does an empty dependency array mean?')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('says the material is not lost, which is the actual fear', async () => {
    const user = userEvent.setup();
    popState = { day: null, dailyCount: 3, lastShownAt: null, consecutiveDismissals: 2, backoffUntil: null };
    render(<Card item={item} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(await screen.findByText(/Nothing is lost/i)).toBeTruthy();
    expect(screen.getByText(/comes back in the queue/i)).toBeTruthy();
  });
});
