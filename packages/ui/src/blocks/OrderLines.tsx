import type { PublicBlock } from '@learnos/shared';

type Order = Extract<PublicBlock, { kind: 'orderLines' }>;

/** Indices into `block.lines`, in the arrangement the learner has built. */
export function parseOrder(value: string, length: number): number[] {
  const parsed = value
    .split(',')
    .map((n) => Number.parseInt(n, 10))
    .filter((n) => Number.isInteger(n) && n >= 0 && n < length);

  // Any malformed or partial value falls back to the order as shown, so a bad
  // stored value cannot render a list with lines missing or duplicated.
  const complete = parsed.length === length && new Set(parsed).size === length;
  return complete ? parsed : Array.from({ length }, (_, i) => i);
}

/**
 * Put the lines in order (T-087's sibling, T-086's cousin).
 *
 * **Moved with buttons, not dragged.** The design says "drags 4–6 shuffled
 * lines into order", and this deliberately does not: HTML5 drag-and-drop does
 * not fire on touch at all, and it is invisible to a screen reader without a
 * parallel keyboard implementation — which is the same objection T-087 raised
 * against click handlers on `<div>`s, and it was right there too.
 *
 * Up and down buttons are keyboard-native, work under a thumb, need no library,
 * and leave the data contract untouched — so a drag affordance can be layered
 * on top later as an enhancement rather than a rewrite.
 *
 * The lines arrive shuffled by the worker, identically for every learner on the
 * topic, and the shuffle is guaranteed never to be the correct order — so
 * submitting the arrangement untouched is always wrong, and the card is right
 * to wait for a move before it will accept an answer.
 */
export function OrderLines({
  block,
  value,
  onChange,
}: {
  block: Order;
  value: string;
  onChange: (value: string) => void;
}) {
  const arrangement = parseOrder(value, block.lines.length);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= arrangement.length) return;
    const next = [...arrangement];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved as number);
    onChange(next.join(','));
  };

  return (
    <ol className="code order">
      {arrangement.map((lineIndex, position) => (
        <li className="order__row" key={lineIndex}>
          <code className="order__line">{block.lines[lineIndex]}</code>
          <span className="order__moves">
            <button
              type="button"
              className="order__move"
              onClick={() => move(position, position - 1)}
              disabled={position === 0}
              // Names the line, not just the direction: a screen reader user
              // pressing "move up" four times needs to know what moved.
              aria-label={`Move "${block.lines[lineIndex]}" up`}
            >
              ↑
            </button>
            <button
              type="button"
              className="order__move"
              onClick={() => move(position, position + 1)}
              disabled={position === arrangement.length - 1}
              aria-label={`Move "${block.lines[lineIndex]}" down`}
            >
              ↓
            </button>
          </span>
        </li>
      ))}
    </ol>
  );
}
