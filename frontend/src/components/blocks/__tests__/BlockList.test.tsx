/**
 * T-085 — the renderer walks blocks.
 *
 * The acceptance criterion that matters most is the negative one: an item with
 * no blocks must render exactly as it did before, because that is every item
 * generated so far and the whole pilot runs through this component.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PublicBlock, PublicItem } from '../../../shared';
import { BlockList } from '../BlockList';
import { diffRows } from '../CodeDiffBlock';
import { QuestionCard } from '../../QuestionCard';

const SRC = ['function search(a, x) {', '  let lo = 0;', '  let hi = a.length;', '  return -1;', '}'].join('\n');

const code = (over: Partial<Extract<PublicBlock, { kind: 'code' }>> = {}): PublicBlock => ({
  kind: 'code',
  slot: 'context',
  lang: 'javascript',
  src: SRC,
  notes: [],
  ...over,
});

const item = (blocks?: PublicBlock[]): PublicItem => ({
  itemId: '11111111-1111-4111-8111-111111111111',
  conceptId: '22222222-2222-4222-8222-222222222222',
  type: 'application',
  prompt: 'Fix the bound.',
  ...(blocks ? { blocks } : {}),
});

describe('BlockList', () => {
  it('renders a listing with a line-number gutter', () => {
    render(<BlockList blocks={[code()]} />);

    expect(screen.getByText('function search(a, x) {')).toBeInTheDocument();
    // Five lines, five gutter entries.
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('shows a note against its line, and announces the line number', () => {
    render(<BlockList blocks={[code({ notes: [{ line: 3, text: 'one past the end' }] })]} />);

    expect(screen.getByText('one past the end')).toBeInTheDocument();
    // The badge is decorative; a screen reader gets the number in the text.
    expect(screen.getByText('Line 3:')).toBeInTheDocument();
  });

  it('renders prose and a terminal, marking stderr in the markup and not only in colour', () => {
    render(
      <BlockList
        blocks={[
          { kind: 'prose', slot: 'context', text: 'Read this first.' },
          {
            kind: 'terminal',
            slot: 'context',
            command: 'node index.js',
            lines: [
              { text: 'ok', stream: 'out' },
              { text: 'TypeError: x is not a function', stream: 'err' },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText('Read this first.')).toBeInTheDocument();
    expect(screen.getByText('node index.js')).toBeInTheDocument();
    expect(screen.getByText('Error output:')).toBeInTheDocument();
  });

  it('never renders a reveal block, even if one is handed to it', () => {
    // The server drops these (T-080) — a reveal block *is* the answer. This is
    // the second lock, against a future endpoint that forgets.
    render(
      <BlockList
        blocks={[
          code(),
          { kind: 'prose', slot: 'reveal', text: 'THE ANSWER IS lo < hi' },
        ]}
      />,
    );

    expect(screen.queryByText('THE ANSWER IS lo < hi')).not.toBeInTheDocument();
  });

  it('renders nothing rather than a dead end for a kind it does not know yet', () => {
    // The four answer blocks arrive in T-086 to T-088. Until then an item
    // carrying one falls through to QuestionCard's textarea.
    const { container } = render(
      <BlockList blocks={[{ kind: 'orderLines', slot: 'answer', lang: 'javascript', lines: ['a();', 'b();'] }]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('diffRows', () => {
  it('marks only the lines that changed', () => {
    const rows = diffRows('a();\nb();\nc();', 'a();\nB();\nc();');

    expect(rows.map((r) => `${r.mark}${r.text}`)).toEqual([' a();', '−b();', '+B();', ' c();']);
  });

  it('handles a pure insertion', () => {
    const rows = diffRows('a();', 'a();\nb();');
    expect(rows.filter((r) => r.kind === 'add').map((r) => r.text)).toEqual(['b();']);
    expect(rows.filter((r) => r.kind === 'del')).toHaveLength(0);
  });
});

describe('QuestionCard with blocks', () => {
  it('renders an item without blocks exactly as before — prompt and a textarea', () => {
    render(<QuestionCard item={item()} value="" onChange={() => {}} />);

    expect(screen.getByText('Fix the bound.')).toBeInTheDocument();
    expect(screen.getByLabelText('Your answer')).toBeInTheDocument();
    expect(screen.queryByRole('figure')).not.toBeInTheDocument();
  });

  it('shows the blocks between the prompt and the answer surface', () => {
    render(<QuestionCard item={item([code()])} value="" onChange={() => {}} />);

    expect(screen.getByText('Fix the bound.')).toBeInTheDocument();
    // The default normaliser collapses whitespace; a listing's indentation is
    // content, so this asserts it survived rather than that the text appeared.
    expect(screen.getByText('  let lo = 0;', { normalizer: (text) => text })).toBeInTheDocument();
    // The answer surface is still there — blocks add context, they do not
    // replace the way an item is answered.
    expect(screen.getByLabelText('Your answer')).toBeInTheDocument();
  });

  it('still renders options for a recognition item that carries a listing', () => {
    render(
      <QuestionCard
        item={{ ...item([code()]), type: 'recognition', options: ['lo <= hi', 'lo < hi', 'lo != hi', 'lo > hi'] }}
        value={null}
        onChange={() => {}}
      />,
    );

    // Predict-the-output: the listing is context, the options are the answer.
    expect(screen.getByText('lo < hi')).toBeInTheDocument();
    expect(screen.getByText('function search(a, x) {')).toBeInTheDocument();
  });
});
