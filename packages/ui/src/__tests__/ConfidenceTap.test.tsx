import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfidenceTap } from '../index.js';

function Harness() {
  const [value, setValue] = useState<'guess' | 'think' | 'sure' | null>(null);
  return (
    <>
      <ConfidenceTap value={value} onChange={setValue} />
      <output data-testid="value">{value ?? 'none'}</output>
    </>
  );
}

describe('ConfidenceTap', () => {
  it('starts with nothing selected', () => {
    render(<Harness />);
    // A pre-selected default would silently become calibration data.
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).not.toBeChecked();
    }
    expect(screen.getByTestId('value')).toHaveTextContent('none');
  });

  it('reports the rating that was tapped', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('radio', { name: 'Certain' }));

    expect(screen.getByTestId('value')).toHaveTextContent('sure');
  });

  it('keeps one selection at a time', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('radio', { name: 'Guessing' }));
    await user.click(screen.getByRole('radio', { name: 'Fairly sure' }));

    expect(screen.getByRole('radio', { name: 'Guessing' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Fairly sure' })).toBeChecked();
  });
});
