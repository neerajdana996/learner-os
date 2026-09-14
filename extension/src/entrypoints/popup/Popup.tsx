/**
 * The popup, until T-029 puts a question in it.
 *
 * Its one job today is the half of the connect flow that lives in the
 * extension: someone who installs this and clicks the icon must be told what
 * to do next and given the button that does it. Without that, the only route
 * to the options page is Chrome's extension menu, which nobody finds.
 */
import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { Button } from '@learnos/ui';
import { DueItemsResponseSchema, PublicItemSchema, type PublicItem } from '@learnos/shared';
import { apiFetch } from '../../lib/api';
import { record } from '../../lib/telemetry';
import { getPopState, getToken, takePendingCard } from '../../lib/storage';
import { Boundary } from './Boundary';
import { Card } from './Card';

export function Popup() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [card, setCard] = useState<PublicItem | null>(null);
  const [restingUntilTomorrow, setRestingUntilTomorrow] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        await load();
      } catch {
        // Storage is the only thing that can fail here, and a popup that
        // renders nothing at all is the worst possible answer: the learner sees
        // an empty rectangle and no way to act. Treat it as "not connected",
        // which at least offers the button that fixes most causes.
        setConnected(false);
      }
    })();

    async function load() {
      setConnected((await getToken()) !== null);
      // Taken, not read: the worker put one card here and it is answered once.
      // A parse failure means the server changed shape — better to show
      // "nothing due" than to hand the renderer something it cannot draw.
      const pending = await takePendingCard();
      const parsed = PublicItemSchema.safeParse(pending);
      if (parsed.success) {
        setCard(parsed.data);
        return;
      }

      /**
       * Nothing waiting — so ask (T-129).
       *
       * The worker stores a card when it decides to *interrupt* you, on a
       * five-minute alarm. Opening the popup on purpose is the opposite
       * situation, and rendering only what the worker happened to leave behind
       * meant a learner who clicked the icon was told "nothing due right now"
       * while `/due` had a question waiting.
       *
       * **The daily cap, the active windows and the backoff are deliberately
       * not consulted here.** Every one of them exists to decide when it is
       * acceptable to interrupt someone; none of them is a reason to refuse a
       * person who just asked for a question.
       */
      const found = await fetchDue();
      if (found) setCard(found);

      // During a backoff "we'll pop in when something is" is simply false, and
      // a promise the product then fails to keep reads as a broken extension
      // rather than one that took the hint (T-030).
      const state = await getPopState();
      setRestingUntilTomorrow(state.backoffUntil !== null && state.backoffUntil > Date.now());
    }
  }, []);

  // The card owns the whole popup when there is one: no nav, no branding, no
  // score. It has one job and then it goes away.
  if (card) {
    return (
      <Boundary>
        <Card item={card} onClose={() => window.close()} />
      </Boundary>
    );
  }

  return (
    <main className="ext ext--popup">
      <h1 className="ext__title">Cold Recall</h1>
      {connected === null ? null : connected ? (
        <p className="ext__muted">
          {restingUntilTomorrow
            ? 'Resting until tomorrow — you waved off three in a row, so we’ll leave you to it.'
            : 'Nothing due right now. We’ll pop in when something is.'}
        </p>
      ) : (
        <>
          <p className="ext__muted">
            Not connected yet. Paste your extension token to start getting questions.
          </p>
          <Button type="button" onClick={() => browser.runtime.openOptionsPage()}>
            Connect
          </Button>
        </>
      )}
    </main>
  );
}

/**
 * One due item, straight from the server. Returns null for every failure —
 * offline, disconnected, nothing due — because the popup says the same
 * reassuring thing in all of those cases and an error code would not help
 * anyone reading it.
 */
async function fetchDue(): Promise<PublicItem | null> {
  try {
    const response = await apiFetch('/due?limit=1');
    const parsed = DueItemsResponseSchema.safeParse(await response.json());
    const item = parsed.success ? parsed.data.items[0] : undefined;
    if (!item) return null;

    // It counts as shown: the learner is about to read it, and the answer rate
    // needs the same denominator whichever surface offered the card (T-035).
    await record('card_shown', { itemId: item.itemId, opened: 'manually' });
    return item;
  } catch {
    return null;
  }
}
