import type { PublicBlock } from '@learnos/shared';

type Code = Extract<PublicBlock, { kind: 'code' }>;

/**
 * A listing, with a line-number gutter, called-out lines, and a notes rail.
 *
 * Rendered from the block's own `notes` and `dim`, which carry **line numbers**
 * — the model quoted the line text and the worker resolved it (T-080). Nothing
 * here counts lines or matches text; by the time a block reaches a browser the
 * indices are already right or the generation already failed.
 *
 * Syntax colouring is not done here. It happens once in the worker (T-084)
 * rather than on every render on every device — until then a listing renders in
 * `--code-fg`, which is a plain listing, not a broken one.
 */
export function CodeBlock({ block }: { block: Code }) {
  const lines = block.src.split('\n');
  const notedLines = new Map(block.notes.map((note, i) => [note.line, i + 1]));

  return (
    <figure className="code">
      <div className="code__scroll">
        <div className="code__grid">
          {lines.map((line, i) => {
            const n = i + 1;
            const badge = notedLines.get(n);
            const dimmed = block.dim ? n >= block.dim.from && n <= block.dim.to : false;
            const mark = [badge ? 'hit' : null, dimmed ? 'dim' : null].filter(Boolean);
            const cls = (base: string) => [base, ...mark.map((m) => `${base}--${m}`)].join(' ');

            return (
              <div key={n} className="contents">
                <span className={cls('code__gutter')} aria-hidden="true">
                  {badge ?? n}
                </span>
                <code className={cls('code__line')}>{line === '' ? ' ' : line}</code>
              </div>
            );
          })}
        </div>
      </div>

      {block.notes.length > 0 ? (
        <figcaption className="code__notes">
          {block.notes.map((note, i) => (
            <p className="code__note" key={`${note.line}-${note.text}`}>
              <span className="code__badge" aria-hidden="true">
                {i + 1}
              </span>
              {/* The line number is announced, because the badge that carries it
                  visually is decorative and a screen reader gets no gutter. */}
              <span>
                <span className="u-sr-only">Line {note.line}: </span>
                {note.text}
              </span>
            </p>
          ))}
        </figcaption>
      ) : null}
    </figure>
  );
}
