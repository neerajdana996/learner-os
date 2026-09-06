import { describe, expect, it } from 'vitest';
import {
  FAST_POLL_MS,
  FAST_POLL_WINDOW_MS,
  SLOW_POLL_MS,
  generationPollInterval,
  generationProgressLabel,
} from './topicsApi';

describe('generationPollInterval', () => {
  it('polls fast while a quick failure is still plausible', () => {
    expect(generationPollInterval('generating', 0)).toBe(FAST_POLL_MS);
    expect(generationPollInterval('generating', FAST_POLL_WINDOW_MS - 1)).toBe(FAST_POLL_MS);
  });

  it('backs off once the job is clearly a long one', () => {
    // Six minutes at 3s is ~120 requests; at 15s it is ~25 (T-066).
    expect(generationPollInterval('generating', FAST_POLL_WINDOW_MS)).toBe(SLOW_POLL_MS);
    expect(generationPollInterval('generating', 6 * 60_000)).toBe(SLOW_POLL_MS);
  });

  it('stops for good on every terminal status, however long it has been', () => {
    for (const status of ['active', 'failed', 'testing', 'holdout', 'done'] as const) {
      expect(generationPollInterval(status, 0)).toBe(0);
      expect(generationPollInterval(status, 10 * 60_000)).toBe(0);
    }
    expect(generationPollInterval(undefined, 0)).toBe(0);
  });
});

describe('generationProgressLabel', () => {
  it('says something true before the job has reported anything', () => {
    expect(generationProgressLabel(null)).toBe('Starting up…');
    expect(generationProgressLabel(undefined)).toBe('Starting up…');
  });

  it('names the stage, and counts concepts once they start landing', () => {
    expect(generationProgressLabel({ stage: 'map', completed: 0, total: 1 })).toBe(
      'Working out the concepts…',
    );
    expect(generationProgressLabel({ stage: 'content', completed: 0, total: 36 })).toBe(
      'Writing questions for 36 concepts…',
    );
    expect(generationProgressLabel({ stage: 'content', completed: 7, total: 36 })).toBe(
      '7 of 36 concepts written',
    );
    expect(generationProgressLabel({ stage: 'saving', completed: 36, total: 36 })).toBe(
      'Saving your map…',
    );
  });
});
