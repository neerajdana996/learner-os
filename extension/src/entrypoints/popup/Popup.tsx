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
import { PublicItemSchema, type PublicItem } from '@learnos/shared';
import { getToken, takePendingCard } from '../../lib/storage';
import { Card } from './Card';

export function Popup() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [card, setCard] = useState<PublicItem | null>(null);

  useEffect(() => {
    void (async () => {
      setConnected((await getToken()) !== null);
      // Taken, not read: the worker put one card here and it is answered once.
      // A parse failure means the server changed shape — better to show
      // "nothing due" than to hand the renderer something it cannot draw.
      const pending = await takePendingCard();
      const parsed = PublicItemSchema.safeParse(pending);
      if (parsed.success) setCard(parsed.data);
    })();
  }, []);

  // The card owns the whole popup when there is one: no nav, no branding, no
  // score. It has one job and then it goes away.
  if (card) return <Card item={card} onClose={() => window.close()} />;

  return (
    <main className="ext ext--popup">
      <h1 className="ext__title">learnos</h1>
      {connected === null ? null : connected ? (
        // T-029 replaces this with the question card.
        <p className="ext__muted">Nothing due right now. We’ll pop in when something is.</p>
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
