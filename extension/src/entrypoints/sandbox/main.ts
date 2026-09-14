import { evaluateCases, type SandboxCase } from '../../lib/evaluateCases';

/**
 * The manifest sandbox page (T-171) — where a learner's `codeEditor` answer
 * runs. WXT lists `sandbox/index.html` under `sandbox.pages`, so this page has
 * an opaque origin, no `chrome.*` APIs and a CSP that allows `new Function`.
 *
 * It imports nothing that touches the extension: see `evaluateCases.ts` for
 * why that is the entire safety argument.
 */
window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as { __learnosRun?: string; source?: string; cases?: SandboxCase[] };
  if (typeof data?.__learnosRun !== 'string' || typeof data.source !== 'string' || !Array.isArray(data.cases)) return;
  const outcome = evaluateCases(data.source, data.cases);
  (event.source as Window | null)?.postMessage({ __learnosRun: data.__learnosRun, outcome }, '*');
});
