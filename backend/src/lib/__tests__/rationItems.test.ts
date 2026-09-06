import { describe, expect, it } from 'vitest';
import { MAX_EDITORS_PER_SESSION, rationItems, type RationableItem } from '../rationItems.js';

/** A row as `findItemsForConcepts` returns it, plus whatever else the caller carries. */
const item = (id: string, conceptId: string, answerKind: string | null = null) => ({
  id,
  conceptId,
  answerKind,
  payload: { prompt: id },
});

describe('rationItems', () => {
  it('gives every concept exactly one item', () => {
    const chosen = rationItems(
      ['c1', 'c2'],
      [item('a', 'c1'), item('b', 'c1'), item('c', 'c2')],
    );

    expect(chosen.size).toBe(2);
    expect(chosen.get('c1')?.id).toBe('a');
    expect(chosen.get('c2')?.id).toBe('c');
  });

  it('hands out at most one code editor per session', () => {
    // Three editors is eight to twelve minutes against a ten-to-fifteen minute
    // budget — a session nobody finishes, which schedules nothing.
    const chosen = rationItems(
      ['c1', 'c2', 'c3'],
      [
        item('e1', 'c1', 'codeEditor'),
        item('q1', 'c1', 'clozeCode'),
        item('e2', 'c2', 'codeEditor'),
        item('q2', 'c2', 'hotspotLine'),
        item('e3', 'c3', 'codeEditor'),
        item('q3', 'c3', null),
      ],
    );

    const editors = [...chosen.values()].filter((i) => i.answerKind === 'codeEditor');
    expect(editors).toHaveLength(MAX_EDITORS_PER_SESSION);
    expect(chosen.get('c2')?.id).toBe('q2');
    expect(chosen.get('c3')?.id).toBe('q3');
  });

  it('spends the ration on the first concept taught, not the last row returned', () => {
    // Last-one-wins was the old behaviour and made this depend on row order.
    const chosen = rationItems(
      ['c1', 'c2'],
      [
        item('e2', 'c2', 'codeEditor'),
        item('q2', 'c2', 'clozeCode'),
        item('e1', 'c1', 'codeEditor'),
        item('q1', 'c1', 'clozeCode'),
      ],
    );

    expect(chosen.get('c1')?.id).toBe('e1');
    expect(chosen.get('c2')?.id).toBe('q2');
  });

  it('still teaches a concept whose only items are editors', () => {
    // A lesson with an expensive question beats a lesson with none, so the cap
    // is the thing that bends.
    const chosen = rationItems(
      ['c1', 'c2'],
      [item('e1', 'c1', 'codeEditor'), item('e2', 'c2', 'codeEditor')],
    );

    expect(chosen.get('c1')?.id).toBe('e1');
    expect(chosen.get('c2')?.id).toBe('e2');
  });

  it('skips a concept the generator produced nothing for', () => {
    const chosen = rationItems(['c1', 'gap'], [item('a', 'c1')]);

    expect(chosen.has('gap')).toBe(false);
    expect(chosen.size).toBe(1);
  });

  it('carries the caller row through untouched', () => {
    // Generic over the row: the planner needs the payload this function has no
    // business knowing about.
    const chosen = rationItems(['c1'], [item('a', 'c1')]);

    expect(chosen.get('c1')?.payload).toEqual({ prompt: 'a' });
  });

  it('respects a raised cap', () => {
    const chosen = rationItems(
      ['c1', 'c2'],
      [
        item('e1', 'c1', 'codeEditor'),
        item('q1', 'c1', 'clozeCode'),
        item('e2', 'c2', 'codeEditor'),
        item('q2', 'c2', 'clozeCode'),
      ],
      2,
    );

    expect([...chosen.values()].map((i) => i.id)).toEqual(['e1', 'e2']);
  });

  it('takes a bare row without a payload', () => {
    const rows: RationableItem[] = [{ id: 'a', conceptId: 'c1', answerKind: null }];
    expect(rationItems(['c1'], rows).get('c1')?.id).toBe('a');
  });
});
