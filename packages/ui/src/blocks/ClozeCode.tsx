import type { PublicBlock } from '@learnos/shared';

type Cloze = Extract<PublicBlock, { kind: 'clozeCode' }>;

/** Holes are written `{{1}}` inline in `src`. */
const MARKER = /\{\{\s*(\d+)\s*\}\}/g;

/**
 * The separator between hole answers inside the single `response` field.
 *
 * `AnswerSchema.response` is one string, and an item can have two holes. A
 * newline is the one character a blank cannot contain — a hole is an expression
 * inside a line — so it splits unambiguously and still reads in `review_events`
 * as two lines, which JSON would not.
 */
export const CLOZE_SEPARATOR = '\n';

export function joinCloze(values: string[]): string {
  return values.join(CLOZE_SEPARATOR);
}

export function splitCloze(response: string): string[] {
  return response.split(CLOZE_SEPARATOR);
}

/**
 * Fill in the blank (T-086).
 *
 * The inputs sit **inline in the listing**, sized to the hole's own `width` in
 * `ch`. A full-width field under the snippet is a text question with a picture
 * above it: the blank has to be in the code, at the place the question is
 * about, or the format is decoration.
 *
 * Nothing is graded until the learner submits — there is no per-hole feedback,
 * because two holes are one answer and telling someone the first is right turns
 * the second into a guess with a hint.
 */
export function ClozeCode({
  block,
  value,
  onChange,
}: {
  block: Cloze;
  value: string;
  onChange: (value: string) => void;
}) {
  const widths = new Map(block.holes.map((h) => [h.id, h.width]));
  // Marker order is reading order, which is the order the values are stored in.
  const order = [...block.src.matchAll(MARKER)].map((m) => Number(m[1]));
  const values = splitCloze(value);

  const set = (index: number, next: string) => {
    const copy = [...values];
    while (copy.length < order.length) copy.push('');
    copy[index] = next;
    onChange(joinCloze(copy));
  };

  const lines = block.src.split('\n');
  let hole = -1;

  return (
    <figure className="code cloze">
      <div className="code__scroll">
        <div className="code__grid">
          {lines.map((line, i) => {
            // Split on the markers, keeping them, so text and blanks interleave.
            const parts = line.split(MARKER);

            return (
              <div key={i} className="contents">
                <span className="code__gutter" aria-hidden="true">
                  {i + 1}
                </span>
                <code className="code__line">
                  {parts.map((part, p) => {
                    // Odd indices are the captured hole ids.
                    if (p % 2 === 0) return <span key={p}>{part}</span>;

                    hole += 1;
                    const index = hole;
                    const id = Number(part);
                    return (
                      <input
                        key={p}
                        className="cloze__hole"
                        type="text"
                        // `ch` so the field is the width of the answer it wants,
                        // in the listing's own monospace grid.
                        style={{ width: `${Math.max(widths.get(id) ?? 8, 3)}ch` }}
                        value={values[index] ?? ''}
                        onChange={(e) => set(index, e.target.value)}
                        // Position, not just "blank": a screen reader gets no
                        // listing, so "blank 2 of 2" is the only orientation.
                        aria-label={`Blank ${index + 1} of ${order.length}`}
                        autoComplete="off"
                        autoCapitalize="off"
                        spellCheck={false}
                      />
                    );
                  })}
                </code>
              </div>
            );
          })}
        </div>
      </div>
    </figure>
  );
}
