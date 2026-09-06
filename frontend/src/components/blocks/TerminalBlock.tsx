import type { PublicBlock } from '@learnos/shared';

type Terminal = Extract<PublicBlock, { kind: 'terminal' }>;

/**
 * A command and what it printed, including the stack trace.
 *
 * Always dark, whatever surface it sits on — a terminal that follows the theme
 * stops reading as a terminal. `stream` is carried in the markup as well as the
 * colour, so stderr is not a colour-only distinction.
 */
export function TerminalBlock({ block }: { block: Terminal }) {
  return (
    <pre className="terminal">
      {block.command ? <div className="terminal__command">{block.command}</div> : null}
      {block.lines.map((line, index) => (
        <div
          key={`${index}-${line.text}`}
          className={`terminal__line${line.stream === 'err' ? ' terminal__line--err' : ''}`}
        >
          {line.stream === 'err' ? <span className="u-sr-only">Error output: </span> : null}
          {line.text === '' ? ' ' : line.text}
        </div>
      ))}
    </pre>
  );
}
