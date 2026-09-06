import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Prose } from '../Prose';

describe('Prose', () => {
  it('renders inline code spans as code, not as backticks', () => {
    // The model writes examples as code spans because the prompt asks for
    // concrete ones; literal backticks on screen read as a broken product.
    render(<Prose text="For example, in `[2, 3, 1]` the sum is `6`." />);

    const codes = screen.getAllByText(/\[2, 3, 1\]|^6$/);
    expect(codes.map((el) => el.tagName)).toEqual(['CODE', 'CODE']);
    expect(screen.queryByText(/`/)).toBeNull();
  });

  it('leaves an unpaired backtick alone rather than swallowing the rest', () => {
    render(<Prose text="a ` b c" />);
    expect(screen.getByText('a ` b c')).toBeInTheDocument();
  });

  it('renders plain prose unchanged', () => {
    render(<Prose text="No code here at all." />);
    expect(screen.getByText('No code here at all.')).toBeInTheDocument();
  });

  it('does not interpret markup in generated text', () => {
    // This text comes from a model prompted with a learner-supplied topic
    // title, so it is never trusted as markup.
    const { container } = render(<Prose text="<img src=x onerror=alert(1)>" />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  });
});
