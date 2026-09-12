import { useMemo } from 'react';
import { ReactFlow, Background, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

interface DiagramNode {
  id: string;
  label: string;
}

interface DiagramEdge {
  from: string;
  to: string;
  label?: string | null | undefined;
}

export interface FlowDiagramProps {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  alt: string;
}

const NODE_WIDTH = 140;
const NODE_GAP = 90;
const NODE_HEIGHT = 44;

/**
 * The web app's `renderDiagram` override for `BlockList`/`TeachBlockView` (see
 * their own doc comments): a topology the learner can drag and re-inspect,
 * built from the same `nodes`/`edges` the generator already produces — this
 * never invents content, only how it is placed.
 *
 * A fixed row of positions, not an auto-layout library: at most
 * `DIAGRAM_MAX_NODES` (5) nodes ever arrive (`@learnos/shared`), so a second
 * layout dependency would buy nothing a row of even spacing doesn't already
 * give.
 *
 * `alt` is rendered as visible, sr-only text below the canvas rather than only
 * an aria-label on the wrapper: ReactFlow's canvas has its own internal focus
 * order (panning, node buttons), which does not reliably surface a container
 * label the way a static `<figure aria-label>` did for the SVG version.
 */
export function FlowDiagram({ nodes, edges, alt }: FlowDiagramProps) {
  const flowNodes = useMemo<Node[]>(
    () =>
      nodes.map((n, i) => ({
        id: n.id,
        data: { label: n.label },
        position: { x: i * (NODE_WIDTH + NODE_GAP), y: 0 },
        style: {
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 8,
          border: '1px solid var(--border-strong)',
          background: 'var(--surface)',
          color: 'var(--ink)',
          fontSize: 13,
          fontFamily: 'IBM Plex Sans, system-ui, sans-serif',
        },
      })),
    [nodes],
  );

  const flowEdges = useMemo<Edge[]>(
    () =>
      edges
        // Same rule the static renderer enforces (T-108): an edge naming a node
        // that does not exist is dropped rather than drawn to nowhere.
        .filter((e) => nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to))
        .map((e, i) => ({
          id: `${e.from}-${e.to}-${i}`,
          source: e.from,
          target: e.to,
          label: e.label ?? undefined,
          animated: true,
          style: { stroke: 'var(--clay)' },
          labelStyle: { fill: 'var(--ink-2)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 11 },
        })),
    [edges, nodes],
  );

  return (
    <figure className="drawing drawing--flow" role="group" aria-label={alt}>
      <div style={{ height: 220, width: '100%' }}>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          fitView
          proOptions={{ hideAttribution: true }}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable={false}
        >
          <Background gap={16} />
        </ReactFlow>
      </div>
      <figcaption className="u-sr-only">{alt}</figcaption>
    </figure>
  );
}
