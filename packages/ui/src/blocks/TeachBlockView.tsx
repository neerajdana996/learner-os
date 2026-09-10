import { Fragment } from 'react';
import type { TeachBlock } from '@learnos/shared';

/**
 * The visual attached to a concept's `tryFirstPrompt` (T-145) — a listing or a
 * drawing, for a concept whose correct answer is code or a topology rather
 * than a sentence. Distinct from `CodeBlock`/`DrawingBlock`: those render an
 * *item's* block (line notes, dim ranges, a `slot`), and a teaching block has
 * none of that — it is pure context read once before an attempt, never
 * annotated and never graded. Rendering it as a plain, unmarked listing is
 * deliberate: a called-out line here would be a hint, and the whole point of
 * `tryFirstPrompt` is that nothing is hinted yet.
 *
 * Reuses the exact same CSS the item blocks use (`.code`, `.drawing` —
 * `packages/ui/styles/_blocks.scss`) rather than declaring new rules: the
 * markup this produces is a strict subset of `CodeBlock`'s (no gutter badges,
 * no notes rail) and identical to `DrawingBlock`'s.
 */
export function TeachBlockView({ block }: { block: TeachBlock }) {
  if (block.kind === 'code') {
    const lines = block.src.split('\n');
    return (
      <figure className="code">
        <div className="code__scroll">
          <div className="code__grid">
            {lines.map((line, i) => (
              // A React Fragment, not a wrapping <div>: `.code__grid` is a
              // 2-column CSS grid and its direct children must be the two
              // spans below, or CSS Grid places the *wrapper* into one cell
              // instead of one span per column — which is exactly what
              // happened here first (a `className="contents"` copied from
              // `CodeBlock.tsx`, which has no such class defined anywhere in
              // the stylesheet and produces the same broken layout; flagged
              // separately rather than touched here, since it's that
              // component's own bug, not this one's — see T-146's notes).
              <Fragment key={i}>
                <span className="code__gutter" aria-hidden="true">
                  {i + 1}
                </span>
                <code className="code__line">{line === '' ? ' ' : line}</code>
              </Fragment>
            ))}
          </div>
        </div>
      </figure>
    );
  }

  // `diagram` and `sequence` were already drawn to SVG by the worker at
  // generation time (T-108's rule — `teaching.ts`'s `resolveTeachBlock`
  // follows it identically), so this is a placement, not a render. Same
  // safety note as `DrawingBlock`: the markup is ours, never the model's —
  // `TeachBlockGenerationSchema` is `.strict()` with no `svg` field.
  return (
    <figure className="drawing" role="group" aria-label={block.alt}>
      <div className="drawing__svg" dangerouslySetInnerHTML={{ __html: block.svg }} />
      <figcaption className="u-sr-only">{block.alt}</figcaption>
    </figure>
  );
}
