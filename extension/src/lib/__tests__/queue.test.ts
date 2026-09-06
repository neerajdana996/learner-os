import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import type { Answer } from '@learnos/shared';
import {
  BACKOFF_MS,
  drain,
  drainStep,
  enqueue,
  MAX_AGE_MS,
  MAX_ATTEMPTS,
  MAX_QUEUED,
  prune,
  readQueue,
  writeQueue,
  type QueuedAnswer,
} from '../queue';

beforeEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

const answer = (itemId = '11111111-1111-4111-8111-111111111111'): Answer => ({
  itemId,
  response: 'a lease is a lock with an expiry',
  confidence: null,
  surface: 'extension',
  idempotencyKey: '22222222-2222-4222-8222-222222222222',
});

const entry = (over: Partial<QueuedAnswer> = {}): QueuedAnswer => ({
  answer: answer(),
  queuedAt: 1_000,
  attempts: 0,
  nextAttemptAt: 0,
  ...over,
});

class Refused extends Error {
  constructor(readonly status: number) {
    super(String(status));
  }
}

describe('enqueue', () => {
  it('keeps an answer that could not be sent', async () => {
    await enqueue(answer(), 5_000);

    const queued = await readQueue();
    expect(queued).toHaveLength(1);
    expect(queued[0]?.answer.itemId).toBe('11111111-1111-4111-8111-111111111111');
    expect(queued[0]?.queuedAt).toBe(5_000);
  });

  it('reads an absent or corrupt queue as empty rather than throwing', async () => {
    // A corrupt counter must never be able to stop the extension working.
    await fakeBrowser.storage.local.set({ 'learnos.queue': 'not an array' });
    expect(await readQueue()).toEqual([]);
  });
});

describe('prune', () => {
  it('drops an answer too old to record honestly', () => {
    // The server clamps a backdate to the same window, so sending this would
    // record it at a time it did not happen — worse than not sending it, since
    // a missing point is visible in the counts and a wrong one is not.
    const now = 10 * MAX_AGE_MS;
    const kept = prune([entry({ queuedAt: now - MAX_AGE_MS + 1 }), entry({ queuedAt: now - MAX_AGE_MS - 1 })], now);

    expect(kept).toHaveLength(1);
    expect(kept[0]?.queuedAt).toBe(now - MAX_AGE_MS + 1);
  });

  it('caps the queue by dropping the oldest, which are nearest expiry anyway', () => {
    const queue = Array.from({ length: MAX_QUEUED + 3 }, (_, i) => entry({ queuedAt: 1_000 + i }));
    const kept = prune(queue, 2_000);

    expect(kept).toHaveLength(MAX_QUEUED);
    expect(kept[0]?.queuedAt).toBe(1_003);
  });
});

describe('drainStep', () => {
  it('drops what was sent', () => {
    expect(drainStep(entry(), { ok: true }, 2_000)).toEqual({ action: 'drop', why: 'sent' });
  });

  it('drops a 400 instead of blocking the queue behind it', () => {
    // The server understood and refused; it will refuse identically in five
    // minutes, and FIFO means everything good is stuck behind it until it goes.
    expect(drainStep(entry(), { ok: false, status: 400 }, 2_000)).toEqual({
      action: 'drop',
      why: 'rejected',
    });
  });

  it('stops on a 401 but keeps the answers', () => {
    // The token is dead and apiFetch has already cleared it. Reconnecting must
    // still deliver these — dropping them punishes a learner for an expired
    // credential they did not know about.
    expect(drainStep(entry(), { ok: false, status: 401 }, 2_000)).toEqual({
      action: 'stop',
      why: 'unauthorized',
    });
  });

  it('retries a 500 with a backoff', () => {
    const step = drainStep(entry(), { ok: false, status: 500 }, 2_000);

    expect(step).toMatchObject({ action: 'retry' });
    if (step.action !== 'retry') throw new Error('unreachable');
    expect(step.entry.attempts).toBe(1);
    expect(step.entry.nextAttemptAt).toBe(2_000 + (BACKOFF_MS[0] as number));
  });

  it('backs off further on the second failure', () => {
    const step = drainStep(entry({ attempts: 1 }), { ok: false, status: null }, 2_000);

    if (step.action !== 'retry') throw new Error('expected a retry');
    expect(step.entry.attempts).toBe(2);
    expect(step.entry.nextAttemptAt).toBe(2_000 + (BACKOFF_MS[1] as number));
  });

  it('gives up after the last attempt', () => {
    expect(drainStep(entry({ attempts: MAX_ATTEMPTS - 1 }), { ok: false, status: null }, 2_000)).toEqual({
      action: 'drop',
      why: 'exhausted',
    });
  });

  it('waits when the backoff has not expired', () => {
    expect(drainStep(entry({ nextAttemptAt: 9_000 }), { ok: true }, 2_000)).toEqual({
      action: 'stop',
      why: 'not_ready',
    });
  });
});

describe('drain', () => {
  it('sends in the order the answers were given', async () => {
    await writeQueue([
      entry({ answer: answer('aaaaaaaa-1111-4111-8111-111111111111'), queuedAt: 1_000 }),
      entry({ answer: answer('bbbbbbbb-1111-4111-8111-111111111111'), queuedAt: 2_000 }),
    ]);
    const sent: string[] = [];

    const report = await drain(async (a) => void sent.push(a.itemId), 3_000);

    expect(sent).toEqual([
      'aaaaaaaa-1111-4111-8111-111111111111',
      'bbbbbbbb-1111-4111-8111-111111111111',
    ]);
    expect(report).toMatchObject({ sent: 2, dropped: 0, remaining: 0 });
    expect(await readQueue()).toEqual([]);
  });

  it('stamps the time the answer was given, not the time it synced', async () => {
    // This is the whole reason the queue is safe to have: without it a Tuesday
    // answer synced on Friday inflates gapDaysSinceLast by three days, and that
    // gap is the pilot's primary output.
    await writeQueue([entry({ queuedAt: Date.UTC(2026, 8, 1, 12, 0, 0) })]);
    const sent: Answer[] = [];

    await drain(async (a) => void sent.push(a), Date.UTC(2026, 8, 4, 9, 0, 0));

    expect(sent[0]?.answeredAt).toBe('2026-09-01T12:00:00.000Z');
  });

  it('keeps a 500 and stops, rather than hammering a server that is down', async () => {
    await writeQueue([entry({ queuedAt: 1_000 }), entry({ queuedAt: 1_500 })]);
    const send = vi.fn(async () => {
      throw new Refused(500);
    });

    const report = await drain(send, 2_000);

    expect(send).toHaveBeenCalledTimes(1); // never reached the second
    expect(report).toMatchObject({ sent: 0, dropped: 0, remaining: 2, stoppedBy: 'offline' });
    expect((await readQueue())[0]?.attempts).toBe(1);
  });

  it('drops a 400 and carries on with the rest', async () => {
    await writeQueue([
      entry({ answer: answer('aaaaaaaa-1111-4111-8111-111111111111'), queuedAt: 1_000 }),
      entry({ answer: answer('bbbbbbbb-1111-4111-8111-111111111111'), queuedAt: 1_500 }),
    ]);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const send = vi.fn(async (a: Answer) => {
      if (a.itemId.startsWith('aaaa')) throw new Refused(400);
    });

    const report = await drain(send, 2_000);

    expect(report).toMatchObject({ sent: 1, dropped: 1, remaining: 0 });
    expect(await readQueue()).toEqual([]);
  });

  it('keeps everything when the token has died', async () => {
    await writeQueue([entry({ queuedAt: 1_000 }), entry({ queuedAt: 1_500 })]);
    const send = vi.fn(async () => {
      throw new Refused(401);
    });

    const report = await drain(send, 2_000);

    expect(report).toMatchObject({ sent: 0, dropped: 0, remaining: 2, stoppedBy: 'unauthorized' });
    expect(await readQueue()).toHaveLength(2);
  });

  it('leaves a backed-off entry alone until its time comes', async () => {
    await writeQueue([entry({ queuedAt: 1_000, attempts: 1, nextAttemptAt: 9_000 })]);
    const send = vi.fn(async () => {});

    const report = await drain(send, 2_000);

    expect(send).not.toHaveBeenCalled();
    expect(report).toMatchObject({ remaining: 1, stoppedBy: 'not_ready' });
  });

  it('prunes what expired while the device was off', async () => {
    const now = 10 * MAX_AGE_MS;
    await writeQueue([entry({ queuedAt: now - MAX_AGE_MS - 1 })]);
    const send = vi.fn(async () => {});

    const report = await drain(send, now);

    expect(send).not.toHaveBeenCalled();
    expect(report.remaining).toBe(0);
  });
});
