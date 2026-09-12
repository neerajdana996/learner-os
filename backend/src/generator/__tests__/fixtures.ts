// Shared builders for the generator tests (T-161/T-162).
//
// `generateConceptMap` and `generateTeaching` both take a scoped course now
// rather than a bare string, and most tests do not care about the scoping —
// they are about a prereq cycle or a rubric length. These keep the irrelevant
// fields out of the test body while still being real, valid values.
import type { Framing } from '../framing.js';
import type { TeachingInput } from '../teaching.js';

export function aFraming(overrides: Partial<Framing> = {}): Framing {
  return {
    topic: 'React Hooks',
    level: 'working',
    capabilities: [
      {
        id: 'pick-a-hook',
        statement: 'Choose the right hook for a given problem.',
        evidence: 'Given "this value is expensive and only changes with x", names useMemo.',
      },
      {
        id: 'read-a-rerender',
        statement: 'Say why a component re-rendered.',
        evidence: 'Points at the state update rather than the parent.',
      },
      {
        id: 'fix-a-stale-value',
        statement: 'Fix a handler that reads an out-of-date value.',
        evidence: 'Adds the dependency or reaches for a ref, and says which and why.',
      },
    ],
    centralMisconception: 'setState updates the variable immediately, so I can read it on the next line.',
    spine: {
      name: 'A search box with a debounced request',
      description: 'One component holding a query string, debouncing it, and rendering results.',
      whyItFits: 'Every stale-value bug in `fix-a-stale-value` happens in this one component.',
    },
    assumedKnowledge: ['has written a React component', 'knows what props are'],
    outOfScope: ['class components and lifecycle methods', 'state libraries beyond React itself'],
    ...overrides,
  };
}

export function teachingInput(overrides: Partial<TeachingInput> = {}): TeachingInput {
  return {
    topic: 'React Hooks',
    level: 'working',
    concept: 'useState',
    summary: 'Adds state to a function component',
    teachMode: 'try_first',
    spine: 'A search box with a debounced request',
    misconceptions: '- setState updates the variable immediately.',
    items: '- [recall] What does useState return?\n  Answer: the value and a setter',
    prereqs: '',
    notYetTaught: '',
    ...overrides,
  };
}
