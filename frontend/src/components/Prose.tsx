import { Fragment } from 'react';

/**
 * Generated teaching text, rendered the way it was written.
 *
 * The model writes prose with inline code spans — `[2, 3, 1, 2]`, `useState`,
 * `distinctCount <= 2` — because the prompt asks for concrete examples and the
 * examples are code. 17 of 492 generated fields in the first real topic
 * contained them. Rendered as a plain string they arrive on screen with the
 * backticks still in, which reads as a bug in the product rather than a quirk
 * of the text.
 *
 * Deliberately *not* a markdown renderer. This handles the one construct that
 * actually appears, as text nodes — no `dangerouslySetInnerHTML`, so generated
 * content can never inject markup, which matters because this text comes from a
 * model prompted with a learner-supplied topic title.
 */
export function Prose({ text, className }: { text: string; className?: string }) {
  return <p className={className}>{renderCodeSpans(text)}</p>;
}

/** Splits on paired backticks; an unpaired one stays literal text. */
export function renderCodeSpans(text: string) {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, index) =>
    part.startsWith('`') && part.endsWith('`') && part.length > 2 ? (
      <code className="code" key={index}>
        {part.slice(1, -1)}
      </code>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}
