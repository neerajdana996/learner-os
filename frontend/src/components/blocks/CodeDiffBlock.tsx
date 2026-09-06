import { Fragment } from 'react';
import type { PublicBlock } from '@learnos/shared';

type CodeDiff = Extract<PublicBlock, { kind: 'codeDiff' }>;

/**
 * Before and after — often the whole concept is the two-line change.
 *
 * The diff is computed here rather than generated: the model writes two
 * listings and nothing else, which is one fewer thing it can get wrong. This is
 * a line-level longest-common-subsequence, which is enough for the four-to-ten
 * line listings a block may carry (T-080 caps `src` at 12 lines).
 *
 * The `+`/`−` mark carries the meaning as well as the colour. Same rule as the
 * map: never hue alone.
 */
type Row = { mark: '+' | '−' | ' '; text: string; kind: 'add' | 'del' | 'same' };

export function diffRows(before: string, after: string): Row[] {
  const a = before.split('\n');
  const b = after.split('\n');

  // lcs[i][j] = length of the longest common subsequence of a[i:] and b[j:].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? (lcs[i + 1]![j + 1] ?? 0) + 1 : Math.max(lcs[i + 1]![j] ?? 0, lcs[i]![j + 1] ?? 0);
    }
  }

  const rows: Row[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push({ mark: ' ', text: a[i] as string, kind: 'same' });
      i++;
      j++;
    } else if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) {
      rows.push({ mark: '−', text: a[i] as string, kind: 'del' });
      i++;
    } else {
      rows.push({ mark: '+', text: b[j] as string, kind: 'add' });
      j++;
    }
  }
  while (i < a.length) rows.push({ mark: '−', text: a[i++] as string, kind: 'del' });
  while (j < b.length) rows.push({ mark: '+', text: b[j++] as string, kind: 'add' });
  return rows;
}

export function CodeDiffBlock({ block }: { block: CodeDiff }) {
  const rows = diffRows(block.before, block.after);

  return (
    <figure className="code-diff">
      <div className="code-diff__scroll">
        <div className="code-diff__grid">
          {rows.map((row, index) => {
            const suffix = row.kind === 'same' ? '' : `--${row.kind}`;
            return (
              // A fragment, not a wrapper: the mark and the line are direct
              // children of the grid, so the row tint spans both columns.
              <Fragment key={`${index}-${row.text}`}>
                <span className={`code-diff__mark code-diff__mark${suffix}`}>
                  {/* Announced, so the change is not colour-only for a screen
                      reader either. */}
                  <span className="u-sr-only">
                    {row.kind === 'add' ? 'Added: ' : row.kind === 'del' ? 'Removed: ' : 'Unchanged: '}
                  </span>
                  <span aria-hidden="true">{row.mark}</span>
                </span>
                <code className={`code-diff__line code-diff__line${suffix}`}>
                  {row.text === '' ? ' ' : row.text}
                </code>
              </Fragment>
            );
          })}
        </div>
      </div>
      {block.caption ? <figcaption className="code-diff__caption">{block.caption}</figcaption> : null}
    </figure>
  );
}
