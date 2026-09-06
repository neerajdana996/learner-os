/**
 * Draws the systems blocks at generation time (T-108).
 *
 * A diagram the learner only *reads* does not need a graph library on the
 * client, so the worker renders it once, here, and stores the SVG. That is the
 * whole reason `diagram` and `sequence` cost nothing on the extension while
 * `graphBuild` — where the learner draws — still needs a canvas and is deferred.
 *
 * **Colours are `var(--…)`, never literals.** The five names come from
 * `packages/ui/styles/_code-palette.scss`, so a stored SVG follows the theme it
 * is rendered in: the same drawing is correct on paper and on ink, and a token
 * that moves moves here too. A hardcoded `#c9c2b9` would be a light-mode
 * diagram burned into the database.
 *
 * Layout is deliberately dumb — a single row, a single column, fixed spacing.
 * With at most five nodes and three lanes there is no layout problem worth a
 * library, and a deterministic drawing is one a test can assert on.
 */

interface Node {
  id: string;
  label: string;
}
interface Edge {
  from: string;
  to: string;
  label?: string | undefined;
}
interface Message {
  from: string;
  to: string;
  label: string;
  delayed?: boolean | undefined;
}

/** Escapes text before it goes near markup. The labels are model output, and
 *  `ItemGenerationSchema` deliberately allows no markup anywhere — this is the
 *  second lock, so a stray `<` becomes a character rather than a tag. */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const NODE_W = 104;
const NODE_H = 40;
const GAP = 44;
const PAD = 12;

/**
 * Nodes in a row, edges as arcs beneath or above them.
 *
 * Above for a forward edge, below for one that goes back — so a replication
 * loop reads as a loop instead of overlapping the arrow it answers.
 */
export function renderDiagram(nodes: Node[], edges: Edge[]): string {
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const width = PAD * 2 + nodes.length * NODE_W + (nodes.length - 1) * GAP;
  const height = 150;
  const midY = 74;
  const x = (i: number) => PAD + i * (NODE_W + GAP);

  const boxes = nodes
    .map((n, i) => {
      const cx = x(i) + NODE_W / 2;
      return (
        `<rect x="${x(i)}" y="${midY - NODE_H / 2}" width="${NODE_W}" height="${NODE_H}" rx="5" ` +
        `fill="var(--node-fill)" stroke="var(--node-stroke)"/>` +
        `<text x="${cx}" y="${midY + 4}" text-anchor="middle" font-size="12" ` +
        `fill="var(--node-ink)" font-family="IBM Plex Sans, system-ui, sans-serif">${esc(n.label)}</text>`
      );
    })
    .join('');

  const arcs = edges
    .map((e) => {
      const a = index.get(e.from);
      const b = index.get(e.to);
      // An edge naming a node that does not exist is dropped rather than drawn
      // to nowhere. The schema cannot catch it — it validates each field, not
      // the reference — so the drawing is where it surfaces, silently and
      // safely, instead of producing a stray arrow into empty space.
      if (a === undefined || b === undefined || a === b) return '';

      const back = b < a;
      const from = a < b ? x(a) + NODE_W : x(a);
      const to = a < b ? x(b) : x(b) + NODE_W;
      const y = back ? midY + NODE_H / 2 + 4 : midY - NODE_H / 2 - 4;
      const bow = back ? 30 : -30;
      const path = `M ${from} ${y} Q ${(from + to) / 2} ${y + bow} ${to} ${y}`;
      const label = e.label
        ? `<text x="${(from + to) / 2}" y="${y + bow * 0.75}" text-anchor="middle" font-size="10" ` +
          `fill="var(--edge)" font-family="IBM Plex Mono, monospace">${esc(e.label)}</text>`
        : '';
      return `<path d="${path}" fill="none" stroke="var(--edge)" stroke-width="1.25" marker-end="url(#a)"/>${label}`;
    })
    .join('');

  return wrap(width, height, arrowMarker() + boxes + arcs);
}

const LANE_W = 130;
const MSG_GAP = 34;

/**
 * Lanes down a time axis, messages across.
 *
 * Half of distributed systems is an interleaving — a stale read is not a
 * picture of boxes, it is two orders of events — which is why this is a
 * separate block from `diagram` rather than a variation of it. A `delayed`
 * message is drawn sloping and dashed, because that is the whole bug.
 */
export function renderSequence(lanes: string[], messages: Message[]): string {
  const index = new Map(lanes.map((l, i) => [l, i]));
  // A self-message loops out 22px and then labels itself past that, so a loop
  // on the last lane hangs off the right edge. Measured rather than padded by a
  // guess: the first real topic clipped "receive update" clean off.
  const selfOnLast = messages.some((m) => m.from === m.to && index.get(m.from) === lanes.length - 1);
  const overhang = selfOnLast
    ? 28 + Math.max(...messages.filter((m) => m.from === m.to).map((m) => m.label.length)) * 6
    : 0;
  const width = PAD * 2 + lanes.length * LANE_W + overhang;
  const top = 34;
  const height = top + messages.length * MSG_GAP + 18;
  const laneX = (i: number) => PAD + i * LANE_W + LANE_W / 2;

  const heads = lanes
    .map(
      (l, i) =>
        `<text x="${laneX(i)}" y="16" text-anchor="middle" font-size="11" fill="var(--node-ink)" ` +
        `font-family="IBM Plex Sans, system-ui, sans-serif">${esc(l)}</text>` +
        `<line x1="${laneX(i)}" y1="24" x2="${laneX(i)}" y2="${height - 8}" stroke="var(--lane)" stroke-width="1"/>`,
    )
    .join('');

  const arrows = messages
    .map((m, i) => {
      const a = index.get(m.from);
      const b = index.get(m.to);
      if (a === undefined || b === undefined) return '';

      const y = top + i * MSG_GAP;

      // A self-message — "receive, then forward" — is a real idiom and the
      // generator reaches for it unprompted. Dropped, it took a quarter of the
      // messages in the first real distributed-systems topic with it, silently.
      // Drawn as the standard loop out and back.
      if (a === b) {
        const x0 = laneX(a);
        return (
          `<path d="M ${x0} ${y} h 22 v 14 h -22" fill="none" stroke="var(--edge)" ` +
          `stroke-width="1.25" marker-end="url(#a)"/>` +
          `<text x="${x0 + 28}" y="${y + 5}" font-size="10" fill="var(--edge)" ` +
          `font-family="IBM Plex Mono, monospace">${esc(m.label)}</text>`
        );
      }
      // A delayed message lands lower than it left: the slope is the delay, and
      // it is the only thing on the drawing that is not horizontal.
      const y2 = m.delayed ? y + 16 : y;
      const dash = m.delayed ? ' stroke-dasharray="4 3"' : '';
      const stroke = m.delayed ? 'var(--edge-focus)' : 'var(--edge)';
      return (
        `<line x1="${laneX(a)}" y1="${y}" x2="${laneX(b)}" y2="${y2}" stroke="${stroke}" ` +
        `stroke-width="1.25"${dash} marker-end="url(#a)"/>` +
        `<text x="${(laneX(a) + laneX(b)) / 2}" y="${Math.min(y, y2) - 5}" text-anchor="middle" ` +
        `font-size="10" fill="var(--edge)" font-family="IBM Plex Mono, monospace">${esc(m.label)}</text>`
      );
    })
    .join('');

  return wrap(width, height, arrowMarker() + heads + arrows);
}

function arrowMarker(): string {
  return (
    `<defs><marker id="a" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" ` +
    `orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8 z" fill="var(--edge)"/></marker></defs>`
  );
}

/** `role="img"` with no `<title>`: the block carries `alt`, and the renderer
 *  puts it on the wrapping element. Two descriptions would be read twice. */
function wrap(width: number, height: number, body: string): string {
  // Natural width, not `100%`. With `100%` a 414px drawing stretched to fill an
  // 800px column and every label came out at twice its intended size. The
  // stylesheet caps it with `max-width: 100%`, so it scales *down* into a
  // narrow card and never up past 1:1.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `width="${width}" height="${height}" role="img" aria-hidden="true">${body}</svg>`
  );
}
