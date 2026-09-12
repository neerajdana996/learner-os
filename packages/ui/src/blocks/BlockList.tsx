import type { ReactNode } from 'react';
import type { PublicBlock } from '@learnos/shared';
import { CodeBlock } from './CodeBlock.js';
import { CodeDiffBlock } from './CodeDiffBlock.js';
import { DrawingBlock } from './DrawingBlock.js';
import { TerminalBlock } from './TerminalBlock.js';

type DiagramBlock = Extract<PublicBlock, { kind: 'diagram' }>;

/**
 * The walker (T-085).
 *
 * It does not know it is looking at code. Every category rides the same three
 * slots — context, one answer, reveal — which is why maths and system design
 * can land later without touching the session screen.
 *
 * **Content blocks only, for now.** The four answer blocks arrive in T-086 to
 * T-088; until then an item carrying one falls through to `QuestionCard`'s
 * textarea, which is degraded but answerable rather than a dead end. An unknown
 * kind renders nothing at all on purpose: a session screen is the wrong place
 * to discover a schema mismatch, and the item still has its `prompt`.
 *
 * `reveal` blocks never arrive with a question — the server drops them from the
 * public projection, because a reveal block *is* the answer (T-080). Filtering
 * again here is belt and braces against a future endpoint that forgets.
 */
export interface BlockListProps {
  blocks: PublicBlock[];
  /**
   * Lets a host swap in a different `diagram` renderer (the web app uses this
   * for an interactive ReactFlow graph) without this package taking on that
   * dependency itself. Undefined here, `sequence` always, and any kind this
   * returns `null` for all fall back to the static SVG `DrawingBlock` — the
   * only rendering the extension ever gets, so it stays free of a graph
   * library it has no room for in a 380×300 popup.
   */
  renderDiagram?: (block: DiagramBlock) => ReactNode | null;
}

export function BlockList({ blocks, renderDiagram }: BlockListProps) {
  const visible = blocks.filter((block) => block.slot === 'context');
  if (visible.length === 0) return null;

  return (
    <div className="blocks">
      {visible.map((block, index) => (
        <div className="blocks__item" key={`${block.kind}-${index}`}>
          {renderBlock(block, renderDiagram)}
        </div>
      ))}
    </div>
  );
}

function renderBlock(block: PublicBlock, renderDiagram?: (block: DiagramBlock) => ReactNode | null) {
  switch (block.kind) {
    case 'prose':
      return <p className="prose-block">{block.text}</p>;
    case 'code':
      return <CodeBlock block={block} />;
    case 'codeDiff':
      return <CodeDiffBlock block={block} />;
    case 'terminal':
      return <TerminalBlock block={block} />;
    case 'diagram':
      return renderDiagram?.(block) ?? <DrawingBlock block={block} />;
    // A swimlane/timing diagram is not a node graph, so there is no override
    // seam here — `DrawingBlock`'s static SVG is the only rendering.
    case 'sequence':
      return <DrawingBlock block={block} />;
    default:
      return null;
  }
}
