/**
 * Connect the extension to an account (T-027).
 *
 * A pasted token rather than an OAuth dance: the pilot is ten people the
 * founder knows, and `POST /auth/extension-token` already mints exactly this
 * credential for a logged-in web session. The web side that shows the token —
 * "Connect extension" — is T-034.
 *
 * The token is **verified before it is stored**. Saving first and discovering
 * on the next alarm that it was mis-pasted would look like an extension that
 * silently does nothing, which is the hardest failure to report.
 */
import { useEffect, useState } from 'react';
import { Button, Field } from '@learnos/ui';
import { ApiError, API_URL, getMe, NotConnectedError } from '../../lib/api';
import { clearToken, getToken, setToken } from '../../lib/storage';

type State =
  | { kind: 'loading' }
  | { kind: 'disconnected' }
  | { kind: 'checking' }
  | { kind: 'connected'; email: string }
  | { kind: 'error'; message: string };

export function Options() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [token, setTokenInput] = useState('');

  // On open, say whether the *stored* token still works — a revoked session
  // should read as disconnected here, not as a card that never pops.
  useEffect(() => {
    void (async () => {
      if (!(await getToken())) {
        setState({ kind: 'disconnected' });
        return;
      }
      try {
        const me = await getMe();
        setState({ kind: 'connected', email: me.email });
      } catch (error) {
        setState(describe(error));
      }
    })();
  }, []);

  async function connect() {
    setState({ kind: 'checking' });
    try {
      const me = await getMe(token);
      await setToken(token);
      setTokenInput('');
      setState({ kind: 'connected', email: me.email });
    } catch (error) {
      setState(describe(error));
    }
  }

  async function disconnect() {
    await clearToken();
    setState({ kind: 'disconnected' });
  }

  return (
    <main className="ext ext--options">
      <h1 className="ext__title">learnos</h1>

      {state.kind === 'connected' ? (
        <>
          <p className="ext__muted">
            Connected as <strong>{state.email}</strong>. Questions will appear during your active
            windows.
          </p>
          <Button type="button" variant="secondary" onClick={() => void disconnect()}>
            Disconnect
          </Button>
        </>
      ) : (
        <>
          <p className="ext__muted">
            Open the web app, go to <strong>Connect extension</strong>, and paste the token here.
            It stays on this device.
          </p>
          <Field
            label="Extension token"
            value={token}
            onChange={(event) => setTokenInput(event.target.value)}
            placeholder="paste the token"
            autoComplete="off"
            spellCheck={false}
            error={state.kind === 'error' ? state.message : null}
          />
          <p>
            <Button
              type="button"
              disabled={token.trim() === '' || state.kind === 'checking'}
              onClick={() => void connect()}
            >
              {state.kind === 'checking' ? 'Checking…' : 'Connect'}
            </Button>
          </p>
        </>
      )}

      <p className="ext__muted ext__endpoint">Talking to {API_URL}</p>
    </main>
  );
}

/** Every failure the learner can actually act on, in their words. */
function describe(error: unknown): State {
  if (error instanceof NotConnectedError) return { kind: 'disconnected' };
  if (error instanceof ApiError) {
    return error.status === 401
      ? { kind: 'error', message: 'That token was not accepted. Copy a fresh one from the web app.' }
      : { kind: 'error', message: `The server answered ${error.status}. Try again in a moment.` };
  }
  // A failed fetch is the common case when the backend simply isn't running.
  return { kind: 'error', message: `Could not reach ${API_URL}. Is the backend running?` };
}
