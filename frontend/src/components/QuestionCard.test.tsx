import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuestionCard } from './QuestionCard';
import type { PublicItem } from '../shared';

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
