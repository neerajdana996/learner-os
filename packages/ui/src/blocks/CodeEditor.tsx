import { useState, type KeyboardEvent } from 'react';
import type { PublicBlock } from '@learnos/shared';
import { runCases, type RunOutcome } from './runCases.js';

type Editor = Extract<PublicBlock, { kind: 'codeEditor' }>;

/** Languages that run in the browser. Everything else submits and is judged
 *  server-side on the identical screen — the learner cannot tell which. */
const RUNS_HERE = new Set(['javascript', 'typescript']);

const INDENT = '  ';

/**
 * Write the code (T-088).
 *
 * **A textarea, not an editor** (T-081). The design already removes
 * autocomplete, inline type hints and squiggles, because each is a retrieval
 * cue and retrieval is what is being measured — which leaves tab, indent and
 * bracket matching, and those are typing rather than knowing.
 *
 * `autoComplete`, `autoCorrect`, `autoCapitalize` and `spellCheck` are all off
 * and asserted by a test rather than trusted to configuration: a browser that
 * capitalises `const` or underlines a correct identifier is supplying exactly
 * the cue the format exists to withhold.
 *
 * The cases are shown up front as the spec. The first one passes with almost
 * any attempt on purpose — starting from two reds and one green is a debugging
 * problem, and starting from three reds is a blank page.
 */
export function CodeEditor({
  block,
  value,
  onChange,
  onAssisted,
  onSkeleton,
}: {
  block: Editor;
  value: string;
  onChange: (value: string) => void;
  /** Called when the learner takes the hint, so the answer can carry it. */
  onAssisted?: () => void;
  /** Fetches the skeleton — it is never in the payload (T-088). Omit it and the
   *  hint is not offered, which is what a surface with no way to fetch it
   *  should do rather than showing a button that cannot work. */
  onSkeleton?: () => Promise<string>;
}) {
  const [source, setSource] = useState(block.starter);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [running, setRunning] = useState(false);
  const [hinted, setHinted] = useState(false);

  const runsHere = RUNS_HERE.has(block.lang);

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const el = event.currentTarget;

    // Tab types an indent. Escape first, then Tab, still leaves the field — a
    // keyboard user must never be trapped in a textarea.
    if (event.key === 'Tab') {
      event.preventDefault();
      const { selectionStart: a, selectionEnd: b } = el;
      const next = `${source.slice(0, a)}${INDENT}${source.slice(b)}`;
      setSource(next);
      queueMicrotask(() => el.setSelectionRange(a + INDENT.length, a + INDENT.length));
      return;
    }

    // Indent-on-newline: keep the current line's leading whitespace, and add one
    // level after an opening brace. Typing, not knowing.
    if (event.key === 'Enter') {
      const upto = source.slice(0, el.selectionStart);
      const line = upto.slice(upto.lastIndexOf('\n') + 1);
      const lead = /^[ \t]*/.exec(line)?.[0] ?? '';
      const deeper = /[{([]\s*$/.test(line) ? INDENT : '';
      if (!lead && !deeper) return;

      event.preventDefault();
      const insert = `\n${lead}${deeper}`;
      const at = el.selectionStart;
      setSource(`${source.slice(0, at)}${insert}${source.slice(el.selectionEnd)}`);
      queueMicrotask(() => el.setSelectionRange(at + insert.length, at + insert.length));
    }
  }

  async function run() {
    setRunning(true);
    const result = runsHere
      ? await runCases(source, block.cases)
      : // Not run here: the outputs are the source itself, and the server judges
        // it. The screen is identical on purpose, so a learner cannot tell a
        // JavaScript item from a Python one until the verdict comes back.
        ({ ok: true, outputs: { __source: source } } as RunOutcome);

    setOutcome(result);
    setRunning(false);
    // The answer is what the code produced, never the code — grading compares
    // it against expectations the client was never given.
    if (result.ok) onChange(JSON.stringify(result.outputs));
  }

  async function reveal() {
    if (!onSkeleton) return;
    setSource(await onSkeleton());
    setHinted(true);
    onAssisted?.();
  }

  return (
    <div className="editor">
      <p className="editor__signature">
        <code>{block.signature}</code>
      </p>

      <label className="u-sr-only" htmlFor="code-editor">
        Your code
      </label>
      <textarea
        id="code-editor"
        className="editor__area"
        value={source}
        onChange={(e) => setSource(e.target.value)}
        onKeyDown={onKeyDown}
        rows={12}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
      />

      <ol className="editor__cases">
        {block.cases.map((c) => {
          const produced = outcome?.ok ? outcome.outputs[c.name] : undefined;
          return (
            <li className="editor__case" key={c.name}>
              <code className="editor__call">{c.call}</code>
              {/* No expected value: the client is never given one (T-080), and
                  showing three of them would largely give the function away. */}
              {produced !== undefined ? <span className="editor__got">→ {produced}</span> : null}
            </li>
          );
        })}
      </ol>

      {outcome && !outcome.ok ? (
        <p className="editor__error" role="alert">
          {outcome.message}
        </p>
      ) : null}

      <div className="editor__actions">
        <button type="button" className="btn btn--primary" onClick={() => void run()} disabled={running}>
          {running ? 'Running…' : runsHere ? 'Run the cases' : 'Submit'}
        </button>

        {!onSkeleton ? null : hinted ? (
          <p className="editor__hinted">
            Shape shown — this one counts as a lapse, and you will see it again sooner.
          </p>
        ) : (
          <button type="button" className="btn btn--quiet" onClick={() => void reveal()}>
            Show me the shape
          </button>
        )}
      </div>
    </div>
  );
}
