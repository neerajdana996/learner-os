import { useEffect, useRef, useState } from 'react';
import { QuestionCard } from '@learnos/ui';
import { renderFlowDiagram } from '../diagrams/renderFlowDiagram';
import { SAMPLE_QUESTIONS } from './sampleQuestions';

/**
 * A rotating deck of real questions, answerable on the page (T-156).
 *
 * Every card is `QuestionCard` — the exact component the session player uses —
 * so a visitor sees the actual rendering paths (a multiple-choice question, a
 * fill-in-the-blank over a real listing, an interactive topology, a sequence
 * diagram) rather than a drawing of any of them. `sampleQuestions.ts` explains
 * where each one comes from.
 *
 * The first card is always the sliding-window question, so someone arriving
 * mid-scroll always lands on the simplest shape first. After that, an
 * untouched card advances on its own every few seconds — a stranger who is
 * just watching sees the variety without doing anything — and stops the
 * moment there is an answer to look at, so nobody's attempt gets yanked away
 * mid-thought.
 *
 * Deliberately not wired to the API: it must work for a stranger with no
 * session, and an unauthenticated `/due` would be a 401.
 */
const ROTATE_MS = 20000;

export function SampleCard() {
  const [index, setIndex] = useState(0);
  const [value, setValue] = useState<string | number | null>(null);
  const [checked, setChecked] = useState(false);

  const question = SAMPLE_QUESTIONS[index]!;
  const needsCheck = question.item.type !== 'recognition';
  const answered = needsCheck ? checked : value !== null;

  const next = () => {
    setIndex((i) => {
      if (SAMPLE_QUESTIONS.length < 2) return i;
      let n = i;
      while (n === i) n = Math.floor(Math.random() * SAMPLE_QUESTIONS.length);
      return n;
    });
    setValue(null);
    setChecked(false);
  };

  // Untouched cards cycle on their own; touching one (a pick, typing) cancels
  // the timer for that card, same reasoning as `useReveal` elsewhere on this
  // page — a stranger who has started something should never see it move.
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (answered || value !== null) return;
    timer.current = setTimeout(next, ROTATE_MS);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, value, answered]);

  const correct =
    question.item.type === 'recognition'
      ? value === question.answer
      : typeof value === 'string' && value.trim() === question.answer;

  return (
    <div className="sample">
      <div className="sample__bar">
        <span className="u-eyebrow">{eyebrowFor(question.item)}</span>
      </div>

      <div className="sample__body">
        <QuestionCard
          item={question.item}
          value={value}
          onChange={setValue}
          renderDiagram={renderFlowDiagram}
          // The hero is this page's h1; a demo card must not add a second.
          headingLevel={2}
        />

        {needsCheck && !checked ? (
          <button
            type="button"
            className="btn btn--secondary sample__check"
            onClick={() => setChecked(true)}
            disabled={value === null || value === ''}
          >
            Check
          </button>
        ) : null}

        {/* aria-live so the verdict is announced rather than only seen. */}
        <div className="sample__verdict" aria-live="polite">
          {answered ? (
            <>
              <p className={correct ? 'sample__result sample__result--right' : 'sample__result'}>
                {correct ? 'Right.' : 'Not this time.'}
              </p>
              <p className="sample__why">{question.verdict}</p>
              <button type="button" className="btn btn--quiet sample__next" onClick={next}>
                Try another
              </button>
            </>
          ) : (
            <p className="u-muted sample__hint">
              Have a go — you are meant to get some of these wrong. Trying before being told is
              worth more than reading the answer cold.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function eyebrowFor(item: (typeof SAMPLE_QUESTIONS)[number]['item']): string {
  const block = item.blocks?.[0];
  if (block?.kind === 'diagram') return 'A real topology';
  if (block?.kind === 'sequence') return 'A real timing bug';
  if (block?.kind === 'code') return 'A real listing';
  return 'A real question';
}
