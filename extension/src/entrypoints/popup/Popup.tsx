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

const styles = {
  main: { width: 280, padding: 16, fontFamily: 'system-ui, sans-serif', color: '#1c1917' },
  title: { fontSize: 16, margin: 0 },
  muted: { color: '#78716c', fontSize: 13, lineHeight: 1.5 },
  button: { padding: '6px 12px', fontSize: 13, cursor: 'pointer' },
} as const;

export function Popup() {
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    void getToken().then((token) => setConnected(token !== null));
  }, []);

  return (
    <main style={styles.main}>
      <h1 style={styles.title}>learnos</h1>
      {connected === null ? null : connected ? (
        // T-029 replaces this with the question card.
        <p style={styles.muted}>Nothing due right now. We’ll pop in when something is.</p>
      ) : (
        <>
          <p style={styles.muted}>
            Not connected yet. Paste your extension token to start getting questions.
          </p>
          <button type="button" style={styles.button} onClick={() => browser.runtime.openOptionsPage()}>
            Connect
          </button>
        </>
      )}
    </main>
  );
}
