import { FlowDiagram } from './FlowDiagram';

interface DiagramLike {
  nodes: { id: string; label: string }[];
  edges: { from: string; to: string; label?: string | null | undefined }[];
  alt: string;
}

/** The `renderDiagram` override passed to `QuestionCard`/`TeachBlockView`
 *  wherever the web app renders one (see their doc comments in `@learnos/ui`
 *  for why this is a prop rather than baked into that package). */
export function renderFlowDiagram(block: DiagramLike) {
  return <FlowDiagram nodes={block.nodes} edges={block.edges} alt={block.alt} />;
}
