/**
 * Runs a learner's JavaScript against named cases (T-171).
 *
 * **Only ever called inside `sandbox.html`.** That page is listed under the
 * manifest's `sandbox.pages`, so Chrome serves it with an opaque origin and a
 * CSP that permits `new Function` — and in exchange it has no `chrome.*` APIs,
 * no extension storage and no access to the token. Calling this from the side
 * panel itself would fail twice over: the panel's CSP forbids eval, and if it
 * did not, the learner's code would run next to their bearer token.
 *
 * It mirrors `@learnos/ui`'s `runCases` program on purpose — same stringifying,
 * same "threw:" prefix — so an answer grades identically whichever surface ran
 * it. Pure and dependency-free, so it can be unit-tested outside Chrome.
 */

export interface SandboxCase {
  name: string;
  call: string;
}

export type SandboxOutcome =
  | { ok: true; outputs: Record<string, string> }
  | { ok: false; reason: 'error'; message: string };

function show(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

export function evaluateCases(source: string, cases: SandboxCase[]): SandboxOutcome {
  // Every call is wrapped in its own try, inside the same function body as the
  // source, so the calls see the learner's declarations and one throwing case
  // does not lose the others.
  const body = `${source}
return [${cases
    .map(
      (c) => `(function () { try { return __show(${c.call}); } catch (e) { return 'threw: ' + (e && e.message); } })()`,
    )
    .join(',\n')}];`;

  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the whole point: sandboxed learner code (T-171)
    const run = new Function('__show', body) as (s: typeof show) => string[];
    const results = run(show);
    const outputs: Record<string, string> = {};
    cases.forEach((c, i) => {
      outputs[c.name] = results[i] ?? '';
    });
    return { ok: true, outputs };
  } catch (error) {
    return { ok: false, reason: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}
