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
const NODE_GAP = 120;
const NODE_HEIGHT = 44;
const ROW_GAP = 70;

/**
 * Wrap past three (T-108, fixed 2026-09-14).
 *
 * A single row of five is 1060px of content. Fitted into a ~600px card that
 * needs a zoom of about 0.5, which is exactly ReactFlow's default `minZoom` —
 * so the fit was clamped and the last two nodes were simply cut off the right
 * edge. Two nodes (370px) fit at zoom 1, which is why the small diagram looked
 * fine and nobody noticed.
 *
 * Wrapping is the better half of the fix: it makes the natural shape roughly
 * square instead of a long strip, so the fit needs far less zoom and the
 * labels stay readable. `minZoom` is lowered as well, for the narrow-card case
 * where even a wrapped diagram has to shrink.
 */
function rowLength(count: number): number {
  return count > 3 ? Math.ceil(count / 2) : count;
}

/**
 * The web app's `renderDiagram` override for `BlockList`/`TeachBlockView` (see
 * their own doc comments): a topology the learner can drag and re-inspect,
 * built from the same `nodes`/`edges` the generator already produces — this
 * never invents content, only how it is placed.
 *
 * Fixed positions, not an auto-layout library: at most `DIAGRAM_MAX_NODES` (5)
 * nodes ever arrive (`@learnos/shared`), so a second layout dependency would
 * buy nothing that even spacing — wrapped past three, see `rowLength` — does
 * not already give.
 *
 * `alt` is rendered as visible, sr-only text below the canvas rather than only
 * an aria-label on the wrapper: ReactFlow's canvas has its own internal focus
 * order (panning, node buttons), which does not reliably surface a container
 * label the way a static `<figure aria-label>` did for the SVG version.
 */
export function FlowDiagram({ nodes, edges, alt }: FlowDiagramProps) {
  const perRow = rowLength(nodes.length);
  const flowNodes = useMemo<Node[]>(
    () =>
      nodes.map((n, i) => ({
        id: n.id,
        data: { label: n.label },
        position: {
          x: (i % perRow) * (NODE_WIDTH + NODE_GAP),
          y: Math.floor(i / perRow) * (NODE_HEIGHT + ROW_GAP),
        },
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
    [nodes, perRow],
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
          // A chip behind the text, because an edge label sits on top of the
          // line it describes and often beside a node: without a background
          // the two overlap into something unreadable.
          labelBgStyle: { fill: 'var(--surface)' },
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 4,
        })),
    [edges, nodes],
  );

  return (
    <figure className="drawing drawing--flow" role="group" aria-label={alt}>
      <div className="drawing__flow">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          fitView
          fitViewOptions={{ padding: 0.12 }}
          minZoom={0.2}
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
