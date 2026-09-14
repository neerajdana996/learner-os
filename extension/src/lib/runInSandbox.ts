import { browser } from 'wxt/browser';
import type { RunCase, RunOutcome } from '@learnos/ui';

/**
 * The side panel's code runner (T-171): a hidden iframe on the extension's
 * manifest sandbox page, and one message each way.
 *
 * `@learnos/ui`'s default runner builds a `srcdoc` iframe with an inline
 * script. That cannot work in an extension page — the MV3 CSP forbids inline
 * script and eval, and a `srcdoc` frame inherits its parent's policy — so the
 * editor rendered and "Run the cases" silently never answered. A page listed in
 * `sandbox.pages` gets its own, looser CSP and an opaque origin with no
 * extension APIs, which is the same containment the web runner gets from
 * `sandbox="allow-scripts"`.
 *
 * Same two-second budget as the web: then the frame is destroyed.
 */

export const SANDBOX_BUDGET_MS = 2000;

export function runInSandbox(source: string, cases: RunCase[]): Promise<RunOutcome> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.hidden = true;
    const id = crypto.randomUUID();

    let settled = false;
    const finish = (outcome: RunOutcome) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      frame.remove();
      resolve(outcome);
    };

    function onMessage(event: MessageEvent) {
      // The sandbox's origin is opaque ("null"), so identity is the frame's
      // window plus the id this call minted.
      const data = event.data as { __learnosRun?: string; outcome?: RunOutcome };
      if (event.source !== frame.contentWindow || data?.__learnosRun !== id || !data.outcome) return;
      finish(data.outcome);
    }

    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          reason: 'timeout',
          message: `Still running after ${SANDBOX_BUDGET_MS / 1000} seconds — is there a loop that never ends?`,
        }),
      SANDBOX_BUDGET_MS,
    );

    window.addEventListener('message', onMessage);
    frame.addEventListener('load', () => {
      // `'*'` because the target origin is opaque and cannot be named; the
      // frame is ours and was created a line above.
      frame.contentWindow?.postMessage({ __learnosRun: id, source, cases }, '*');
    });
    frame.src = browser.runtime.getURL('/sandbox.html');
    document.body.appendChild(frame);
  });
}
