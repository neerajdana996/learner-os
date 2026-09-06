import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import {
  ABANDONED_AFTER_MS,
  clearCardOpen,
  isAbandoned,
  markCardOpen,
  MAX_BUFFERED,
  readBuffer,
  readCardOpen,
  record,
} from '../telemetry';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('buffering', () => {
  it('keeps an event for the worker instead of sending it', async () => {
    // The popup is destroyed the moment it loses focus, so a fetch started here
    // dies with it — and the event that matters most fires exactly then.
    await record('card_shown', { itemId: 'abc' }, 1_000);

    const buffered = await readBuffer();
    expect(buffered).toHaveLength(1);
    expect(buffered[0]?.event).toBe('card_shown');
    expect(buffered[0]?.at).toBe(new Date(1_000).toISOString());
  });

  it('reads a missing or corrupt buffer as empty', async () => {
    await fakeBrowser.storage.local.set({ 'learnos.telemetry': 'not an array' });
    expect(await readBuffer()).toEqual([]);
  });

  it('drops the oldest once the buffer is full', async () => {
    // A backlog this size means the worker has not run for hours, and recent
    // behaviour is what the answer rate is measured over.
    for (let i = 0; i < MAX_BUFFERED + 5; i += 1) {
      await record('card_shown', { itemId: String(i) }, i);
    }
    const buffered = await readBuffer();

    expect(buffered).toHaveLength(MAX_BUFFERED);
    expect(buffered[0]?.meta?.itemId).toBe('5');
  });
});

describe('the open-card marker', () => {
  it('round trips and clears', async () => {
    await markCardOpen('item-1', 500);
    expect(await readCardOpen()).toEqual({ itemId: 'item-1', openedAt: 500 });

    await clearCardOpen();
    expect(await readCardOpen()).toBeNull();
  });

  it('is not abandoned while someone could still be reading', async () => {
    // Calling a live card abandoned records a non-answer *and* a dismissal
    // against someone who is mid-thought, and three of those stop the day.
    const open = { itemId: 'x', openedAt: 1_000 };
    expect(isAbandoned(open, 1_000 + ABANDONED_AFTER_MS - 1)).toBe(false);
  });

  it('is abandoned once the window has passed', () => {
    const open = { itemId: 'x', openedAt: 1_000 };
    expect(isAbandoned(open, 1_000 + ABANDONED_AFTER_MS)).toBe(true);
  });

  it('is never abandoned when no card was open', () => {
    expect(isAbandoned(null, Number.MAX_SAFE_INTEGER)).toBe(false);
  });
});
