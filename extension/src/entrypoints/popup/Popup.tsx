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
import { getToken } from '../../lib/storage';

export function Popup() {
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    void getToken().then((token) => setConnected(token !== null));
  }, []);

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
          <button type="button" className="ext__button" onClick={() => browser.runtime.openOptionsPage()}>
            Connect
          </button>
        </>
      )}
    </main>
  );
}
