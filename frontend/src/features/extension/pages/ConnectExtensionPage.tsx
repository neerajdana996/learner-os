import { useState } from 'react';
import { Button } from '../../../components/Button';
import { useMeQuery } from '../../users/usersApi';
import { useExtensionTokenMutation } from '../../auth/authApi';

/**
 * The web half of connecting the extension (T-034).
 *
 * The extension's own options page tells you to "open the web app, go to
 * Connect extension" — and until now that screen did not exist, so the only
 * way to get a token was a curl in the README. For a pilot participant who is
 * not a developer that is not a route at all, and the extension is where most
 * of the retrieval is supposed to happen.
 *
 * The token is shown **once**, on demand. It is a live bearer credential for
 * the account, so it is minted by an explicit click rather than rendered into
 * the page for anyone who wanders past, and there is no "show it again" — a
 * second click issues a second token instead.
 */
export default function ConnectExtensionPage() {
  const { data: me } = useMeQuery();
  const [mint, { data, isLoading, error }] = useExtensionTokenMutation();
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.token);
      setCopied(true);
    } catch {
      // A denied clipboard permission is not an error worth a red box — the
      // token is on screen and can be selected by hand.
      setCopied(false);
    }
  }

  return (
    <div className="u-stack u-stack--loose u-measure">
      <div className="u-stack u-stack--tight">
        <h1>Connect the extension</h1>
        <p className="u-muted">
          Most of the remembering happens between sessions — a twenty-second question while
          you&rsquo;re already at your desk. This is the one-time setup.
        </p>
      </div>

      <ol className="steps">
        <li className="steps__item">
          <span className="steps__n">1</span>
          <div>
            <p className="steps__title">Install it</p>
            <p className="steps__body">
              It isn&rsquo;t in the Chrome Web Store yet. Open <code className="code">chrome://extensions</code>,
              turn on <strong>Developer mode</strong>, choose <strong>Load unpacked</strong>, and pick the
              folder you were sent.
            </p>
          </div>
        </li>

        <li className="steps__item">
          <span className="steps__n">2</span>
          <div>
            <p className="steps__title">Get your token</p>
            <p className="steps__body">
              This is a key to your account. Don&rsquo;t share it, and don&rsquo;t paste it anywhere
              but the extension.
            </p>
            {data ? (
              <div className="token">
                <code className="token__value">{data.token}</code>
                <Button variant="secondary" onClick={() => void copy()}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            ) : (
              <p>
                <Button onClick={() => void mint()} disabled={isLoading}>
                  {isLoading ? 'Creating…' : 'Create a token'}
                </Button>
              </p>
            )}
            {error ? <p className="u-muted">That didn&rsquo;t work. Try again in a moment.</p> : null}
          </div>
        </li>

        <li className="steps__item">
          <span className="steps__n">3</span>
          <div>
            <p className="steps__title">Paste it in</p>
            <p className="steps__body">
              Click the learnos icon in Chrome&rsquo;s toolbar, then <strong>Connect</strong>. Paste the
              token and you&rsquo;re done — questions will only appear during the hours you chose.
            </p>
          </div>
        </li>
      </ol>

      {me?.hasExtensionToken ? (
        <p className="u-muted">
          You&rsquo;ve connected an extension before. Creating a new token doesn&rsquo;t break the old
          one — if you&rsquo;ve lost a device, say so and we&rsquo;ll revoke it.
        </p>
      ) : null}
    </div>
  );
}
