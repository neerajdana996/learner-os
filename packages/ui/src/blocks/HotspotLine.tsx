import type { PublicBlock } from '@learnos/shared';

type Hotspot = Extract<PublicBlock, { kind: 'hotspotLine' }>;

/**
 * Click the line that is wrong (T-087).
 *
 * The cheapest real question the product can ask about code — 8 to 15 seconds,
 * one tap, no keyboard — which is why the extension leans on it.
 *
 * **A radio group, not click handlers on `<div>`s.** Arrow keys move between
 * lines and space selects, for free, because that is what a radio group does.
 * Hand-rolled tap targets would need all of that written and would still be
 * invisible to a screen reader, and a card that only works with a mouse is a
 * card a third of people cannot answer.
 *
 * The tap *is* the answer: there is no submit. The value is the 1-based line
 * number, which is what grading compares against — including the neighbour,
 * when the fix is an insertion and the line that should change is not on screen.
 */
export function HotspotLine({
  block,
  value,
  onChange,
}: {
  block: Hotspot;
  value: number | null;
  onChange: (line: number) => void;
}) {
  const lines = block.src.split('\n');

  return (
    <fieldset className="code hotspot">
      <legend className="u-sr-only">Choose the line that is wrong</legend>
      <div className="code__scroll">
        <div className="hotspot__grid">
          {lines.map((line, i) => {
            const n = i + 1;
            const checked = value === n;
            return (
              <label
                key={n}
                className={['hotspot__line', checked && 'hotspot__line--picked'].filter(Boolean).join(' ')}
              >
                <input
                  type="radio"
                  name="hotspot"
                  className="u-sr-only"
                  checked={checked}
                  onChange={() => onChange(n)}
                />
                <span className="code__gutter" aria-hidden="true">
                  {n}
                </span>
                {/* The line number is in the accessible name because the gutter
                    is decorative and a screen reader gets no grid. */}
                <code className="code__line">
                  <span className="u-sr-only">Line {n}: </span>
                  {line === '' ? ' ' : line}
                </code>
              </label>
            );
          })}
        </div>
      </div>
    </fieldset>
  );
}
