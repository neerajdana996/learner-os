/**
 * Runs a learner's function against named cases, in a sandbox (T-088).
 *
 * **`<iframe sandbox="allow-scripts">` on a blank `srcdoc`, not `eval`.** The
 * frame gets an opaque origin: no `document.cookie`, no `localStorage`, no
 * access to the parent document, and no session to steal. `eval` and `new
 * Function` run in *this* page, with this page's origin and this learner's
 * session — for code the learner typed that is merely careless, but the design
 * has to hold when a shared item or a mis-generated one is the source.
 *
 * `allow-same-origin` is deliberately **absent**. With it, the sandbox is not
 * one.
 *
 * Two seconds, then the frame is destroyed. A `while(true)` is the most common
 * wrong answer to a loop question, and a hung tab loses the learner's work.
 */

export interface RunCase {
  name: string;
  call: string;
}

export type RunOutcome =
  | { ok: true; outputs: Record<string, string> }
  | { ok: false; reason: 'timeout' | 'error'; message: string };

export const RUN_BUDGET_MS = 2000;

/**
 * The frame's whole program. It evaluates the learner's source, runs each call,
 * and posts the results back as strings.
 *
 * Every value is stringified *inside* the frame: `postMessage` structured-clones
 * its argument, and a function or a cyclic object would throw there rather than
 * here, losing the run for a reason the learner cannot act on.
 */
function program(source: string, cases: RunCase[]): string {
  return `<script>
    (function () {
      function show(v) {
        if (typeof v === 'string') return v;
        try { return JSON.stringify(v); } catch (e) { return String(v); }
      }
      var out = {};
      try {
        ${source}
        ${cases
          .map(
            (c) =>
              `try { out[${JSON.stringify(c.name)}] = show(${c.call}); }
               catch (e) { out[${JSON.stringify(c.name)}] = 'threw: ' + (e && e.message); }`,
          )
          .join('\n')}
      } catch (e) {
        parent.postMessage({ __learnos: true, error: String(e && e.message) }, '*');
        return;
      }
      parent.postMessage({ __learnos: true, outputs: out }, '*');
    })();
  <\\/script>`;
}

export function runCases(source: string, cases: RunCase[]): Promise<RunOutcome> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.sandbox.add('allow-scripts');
    frame.style.display = 'none';

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
      // Only this frame's messages. A sandboxed frame has an opaque origin, so
      // `event.origin` is "null" and cannot be checked — the source identity and
      // the marker are what distinguish it from any other postMessage on the
      // page.
      const data = event.data as { __learnos?: boolean; outputs?: Record<string, string>; error?: string };
      if (event.source !== frame.contentWindow || data?.__learnos !== true) return;
      if (data.error) return finish({ ok: false, reason: 'error', message: data.error });
      finish({ ok: true, outputs: data.outputs ?? {} });
    }

    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          reason: 'timeout',
          message: `Still running after ${RUN_BUDGET_MS / 1000} seconds — is there a loop that never ends?`,
        }),
      RUN_BUDGET_MS,
    );

    window.addEventListener('message', onMessage);
    frame.srcdoc = program(source, cases);
    document.body.appendChild(frame);
  });
}
