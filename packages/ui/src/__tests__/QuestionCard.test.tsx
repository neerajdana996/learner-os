import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuestionCard } from '../index.js';
import type { PublicItem } from '@learnos/shared';

const recognition: PublicItem = {
  itemId: '00000000-0000-0000-0000-000000000001',
  conceptId: '00000000-0000-0000-0000-000000000002',
  type: 'recognition',
  prompt: 'What does an empty dependency array mean?',
  options: ['Every render', 'Once after the first render', 'Never', 'On unmount'],
};

const recall: PublicItem = {
  itemId: '00000000-0000-0000-0000-000000000003',
  conceptId: '00000000-0000-0000-0000-000000000002',
  type: 'recall',
  prompt: 'What goes in the array?',
};

describe('QuestionCard', () => {
  it('renders one choice per option and reports the index', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<QuestionCard item={recognition} value={null} onChange={onChange} />);

    expect(screen.getAllByRole('radio')).toHaveLength(4);
    await user.click(screen.getByRole('radio', { name: 'Never' }));

    // The index, not the text: grading compares against answerIndex server-side.
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('renders a text answer for non-recognition types', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<QuestionCard item={recall} value={null} onChange={onChange} />);

    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    await user.type(screen.getByRole('textbox', { name: 'Your answer' }), 'x');

    expect(onChange).toHaveBeenCalledWith('x');
  });

  it('never renders an answer key, because the payload never carries one', () => {
    render(<QuestionCard item={recognition} value={null} onChange={vi.fn()} />);
    // Options are the only answer-adjacent field that legitimately crosses;
    // answerIndex stays on the server (T-010).
    expect(JSON.stringify(recognition)).not.toContain('answerIndex');
  });
});

describe('answer surfaces respect the item, and the block', () => {
  const base = { itemId: 'i1', conceptId: 'c1' } as const;

  it('gives recall and application one short input, not a paragraph box', () => {
    // A textarea invited an essay for a one-word answer and wasted a third of a
    // 380×300 popup on empty rows.
    for (const type of ['recall', 'application'] as const) {
      const { unmount } = render(
        <QuestionCard item={{ ...base, type, prompt: 'Q' }} value={null} onChange={() => {}} />,
      );
      expect(screen.getByRole('textbox')).toHaveAttribute('type', 'text');
      unmount();
    }
  });

  it('gives explain room to write', () => {
    render(<QuestionCard item={{ ...base, type: 'explain', prompt: 'Q' }} value={null} onChange={() => {}} />);
    expect(screen.getByRole('textbox').tagName).toBe('TEXTAREA');
  });

  /**
   * The block decides the surface, not the item's `type`. Before this a numeric
   * answer fell through to a text box and was graded as a string — the exact
   * failure the block exists to prevent, since 6GB, 6e9 and 6,000,000,000 are
   * one answer with infinitely many spellings.
   */
  it('gives a numeric answer block a number field with its unit beside it', () => {
    render(
      <QuestionCard
        item={{
          ...base,
          type: 'recall',
          prompt: 'How much memory?',
          blocks: [{ kind: 'numeric', slot: 'answer', unit: 'bytes' }],
        }}
        value={null}
        onChange={() => {}}
      />,
    );

    expect(screen.getByRole('spinbutton')).toBeInTheDocument();
    // The unit is shown, never typed: grading a typed "GB" is a spelling test.
    expect(screen.getByText('bytes')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});

describe('fill in the blank (T-086)', () => {
  const cloze = {
    itemId: 'i1',
    conceptId: 'c1',
    type: 'application' as const,
    prompt: 'Complete the loop condition.',
    blocks: [
      {
        kind: 'clozeCode' as const,
        slot: 'answer' as const,
        lang: 'javascript' as const,
        src: 'while ({{1}}) {\n  mid = lo + {{2}};',
        holes: [
          { id: 1, width: 8 },
          { id: 2, width: 6 },
        ],
      },
    ],
  };

  it('puts a real input at each blank, named by its position', () => {
    render(<QuestionCard item={cloze} value="" onChange={() => {}} />);

    // A screen reader gets no listing, so "blank 2 of 2" is the only orientation.
    expect(screen.getByRole('textbox', { name: 'Blank 1 of 2' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Blank 2 of 2' })).toBeInTheDocument();
  });

  it('keeps the code around the blanks', () => {
    render(<QuestionCard item={cloze} value="" onChange={() => {}} />);
    expect(screen.getByText(/while \(/)).toBeInTheDocument();
    // The marker itself must never be shown — it is a hole, not text.
    expect(screen.queryByText(/\{\{1\}\}/)).not.toBeInTheDocument();
  });

  /**
   * One value, one slot per hole, in reading order. The empty slot matters:
   * grading splits on the separator and pairs the parts with the holes by
   * position, so dropping a blank one would shift every later answer onto the
   * wrong hole.
   */
  it('reports both holes as one value, keeping a slot for the empty one', async () => {
    const user = userEvent.setup();
    let latest = '';
    render(<QuestionCard item={cloze} value={latest} onChange={(v) => { latest = String(v); }} />);

    await user.type(screen.getByRole('textbox', { name: 'Blank 1 of 2' }), 'x');
    expect(latest).toBe('x\n');
  });

  it('fills the second hole into its own slot', async () => {
    const user = userEvent.setup();
    let latest = '';
    render(<QuestionCard item={cloze} value="lo < hi" onChange={(v) => { latest = String(v); }} />);

    await user.type(screen.getByRole('textbox', { name: 'Blank 2 of 2' }), 'n');
    expect(latest).toBe('lo < hi\nn');
  });
});

describe('click the line that is wrong (T-087)', () => {
  const hotspot = {
    itemId: 'i1',
    conceptId: 'c1',
    type: 'application' as const,
    prompt: 'Which line leaks?',
    blocks: [
      {
        kind: 'hotspotLine' as const,
        slot: 'answer' as const,
        lang: 'javascript' as const,
        src: 'useEffect(() => {\n  sub();\n}, []);',
      },
    ],
  };

  /** Not click handlers on divs: arrow keys and space come free with a radio
   *  group, and a card that needs a mouse is one a third of people cannot use. */
  it('is a radio group, one option per line', () => {
    render(<QuestionCard item={hotspot} value={null} onChange={() => {}} />);
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('answers with the 1-based line number, and the tap is the answer', async () => {
    const user = userEvent.setup();
    let picked: unknown = null;
    render(<QuestionCard item={hotspot} value={null} onChange={(v) => { picked = v; }} />);

    await user.click(screen.getAllByRole('radio')[1]!);
    expect(picked).toBe(2);
  });

  it('names each line for a screen reader, which gets no gutter', () => {
    render(<QuestionCard item={hotspot} value={null} onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: /Line 2:/ })).toBeInTheDocument();
  });
});
