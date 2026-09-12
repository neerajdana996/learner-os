/**
 * T-146 — a multi-line listing must not render as a garbled, interleaved mess.
 *
 * The bug this guards against is structural, not textual: `screen.getByText`
 * finds a line's text regardless of where in the DOM it ended up, so
 * `BlockList.test.tsx`'s existing "renders a listing" test passed throughout
 * — every line's text and every gutter number were present *somewhere* on the
 * page, just not laid out as one row per line. Found live, by eye, in the
 * Browser preview: `.code__grid` is a 2-column CSS grid, and each line used to
 * be wrapped in `<div className="contents">` to make its two spans direct
 * grid children — except no `.contents { display: contents }` rule exists
 * anywhere in the stylesheet, so each wrapper div became its own grid cell,
 * alternating columns per line instead of each line spanning both.
 *
 * The fix is a React Fragment instead of the wrapping div, and the test below
 * asserts the two things that actually catch a regression to the old
 * behavior: every gutter/line pair is a *direct* child of `.code__grid` (no
 * wrapper), and the gutter numbers read 1..n in DOM order.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { PublicBlock } from '@learnos/shared';
import { CodeBlock } from '../index.js';

type Code = Extract<PublicBlock, { kind: 'code' }>;

const TEN_LINES: Code = {
  kind: 'code',
  slot: 'context',
  lang: 'javascript',
  src: [
    'function Counter() {',
    '  let count = 0;',
    '',
    '  function handleClick() {',
    '    count = count + 1;',
    '    console.log(count);',
    '  }',
    '',
    '  return <button onClick={handleClick}>{count}</button>;',
    '}',
  ].join('\n'),
  notes: [],
};

describe('CodeBlock', () => {
  it('lays out every gutter number and line as a direct child of the grid, in order', () => {
    const { container } = render(<CodeBlock block={TEN_LINES} />);

    const grid = container.querySelector('.code__grid');
    expect(grid).not.toBeNull();

    // No wrapper: exactly one gutter span and one line element per source
    // line, both direct children of the grid. A regression to
    // `<div className="contents">` doesn't remove these elements — CSS
    // can't do that — so this alone wouldn't have caught the bug; it is the
    // ordering assertion below that does.
    const children = Array.from(grid!.children);
    expect(children).toHaveLength(TEN_LINES.src.split('\n').length * 2);

    // Gutter numbers must read 1..10 in DOM order. Under the old bug, CSS
    // Grid's auto-placement put each wrapper div in its own single cell —
    // the *rendered* order was unaffected (still 1..10 down one flattened
    // sequence), so what actually broke was the *visual pairing*, which a
    // jsdom-based test can't see directly. What it can see: with the
    // wrapper gone, this test's success is contingent on the source being
    // exactly this — direct children — which is what makes the CSS grid's
    // column-per-child assumption hold in the first place.
    const gutters = children.filter((el) => el.classList.contains('code__gutter'));
    expect(gutters.map((el) => el.textContent)).toEqual(
      Array.from({ length: 10 }, (_, i) => String(i + 1)),
    );

    const lines = children.filter((el) => el.tagName === 'CODE');
    expect(lines.map((el) => el.textContent)).toEqual([
      'function Counter() {',
      '  let count = 0;',
      ' ', // blank source lines render a non-breaking space, not a plain one
      '  function handleClick() {',
      '    count = count + 1;',
      '    console.log(count);',
      '  }',
      ' ',
      '  return <button onClick={handleClick}>{count}</button>;',
      '}',
    ]);
  });

  it('has no leftover wrapper element between the grid and its spans', () => {
    const { container } = render(<CodeBlock block={{ ...TEN_LINES, src: 'const x = 1;' }} />);
    const grid = container.querySelector('.code__grid')!;

    // Every direct child must be the gutter span or the line element itself
    // — never a DIV, which is what the old per-line wrapper was.
    for (const child of Array.from(grid.children)) {
      expect(child.tagName).not.toBe('DIV');
    }
  });

  /**
   * T-156 — a note past line 1 used to overwrite its own row's gutter number.
   *
   * `notedLines` maps a line number to that note's 1-based *rank* (for the
   * small circle in the caption below), and the gutter used to display that
   * rank instead of the line's own number on a hit row. A single note on line
   * 3 has rank 1, so line 3's gutter read "1" — indistinguishable from line 1
   * — while every unannotated line still read correctly. Found live while
   * building the landing page's code sample.
   */
  it('keeps the true line number in the gutter for a note past line 1', () => {
    const withLateNote: Code = { ...TEN_LINES, notes: [{ line: 3, text: 'off by one here' }] };
    const { container } = render(<CodeBlock block={withLateNote} />);

    const gutters = Array.from(container.querySelectorAll('.code__gutter'));
    expect(gutters.map((el) => el.textContent)).toEqual(
      Array.from({ length: 10 }, (_, i) => String(i + 1)),
    );
    expect(gutters[2]).toHaveClass('code__gutter--hit');
  });
});
