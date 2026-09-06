import type { PublicBlock } from '@learnos/shared';
import { CodeBlock } from './CodeBlock.js';
import { CodeDiffBlock } from './CodeDiffBlock.js';
import { TerminalBlock } from './TerminalBlock.js';

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
export function BlockList({ blocks }: { blocks: PublicBlock[] }) {
  const visible = blocks.filter((block) => block.slot === 'context');
  if (visible.length === 0) return null;

  return (
    <div className="blocks">
      {visible.map((block, index) => (
        <div className="blocks__item" key={`${block.kind}-${index}`}>
          {renderBlock(block)}
        </div>
      ))}
    </div>
  );
}

function renderBlock(block: PublicBlock) {
  switch (block.kind) {
    case 'prose':
      return <p className="prose-block">{block.text}</p>;
    case 'code':
      return <CodeBlock block={block} />;
    case 'codeDiff':
      return <CodeDiffBlock block={block} />;
    case 'terminal':
      return <TerminalBlock block={block} />;
    default:
      return null;
  }
}
