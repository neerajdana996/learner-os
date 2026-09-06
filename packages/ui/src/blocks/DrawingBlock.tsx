import type { PublicBlock } from '@learnos/shared';

type Drawing = Extract<PublicBlock, { kind: 'diagram' | 'sequence' }>;

/**
 * A diagram or a sequence (T-108).
 *
 * The SVG was drawn by the worker at generation time, which is why reading one
 * costs no graph library here. Both kinds render identically — the difference
 * is entirely in what the worker drew — so one component serves both rather
 * than two that would drift.
 *
 * **On `dangerouslySetInnerHTML`.** The markup is ours, not the model's: the
 * generation schema is `.strict()` and has no `svg` field, so a model that
 * tries to send one is rejected at the boundary, and `systemsSvg.ts` escapes
 * every label it draws. Both of those are tested. This is the only way to place
 * an SVG document produced elsewhere, and the alternative — shipping nodes and
 * edges and redrawing on the client — is exactly the graph library the design
 * exists to avoid.
 *
 * The SVG itself is `aria-hidden`; `alt` carries the meaning. A screen reader
 * that walked the drawing would read a list of disconnected labels, which is
 * worse than the sentence the generator was required to write.
 */
export function DrawingBlock({ block }: { block: Drawing }) {
  return (
    <figure className="drawing" role="group" aria-label={block.alt}>
      <div className="drawing__svg" dangerouslySetInnerHTML={{ __html: block.svg }} />
      <figcaption className="u-sr-only">{block.alt}</figcaption>
    </figure>
  );
}
