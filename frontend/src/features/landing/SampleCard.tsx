import { useState } from 'react';
import { Choice } from '@learnos/ui';

/**
 * One real question, answerable on the page.
 *
 * The strongest thing this page can do is let someone feel the loop rather than
 * read about it, and the loop is twenty seconds long — so it fits. This is a
 * genuine sliding-window item in the shape the extension serves, rendered with
 * the same `Choice` the session player uses, so what a visitor tries here is
 * what they get on day one rather than a drawing of it.
 *
 * Deliberately not wired to the API: it must work for a stranger with no
 * session, and an unauthenticated `/due` would be a 401.
 */
const OPTIONS = [
  'Shrink it from the left until the duplicate is gone',
  'Reset both pointers and start again from the right',
  'Grow it from the right and record the new maximum',
  'Swap the duplicate character out of the string',
] as const;

const ANSWER = 0;

export function SampleCard() {
  const [picked, setPicked] = useState<number | null>(null);
  const answered = picked !== null;
  const correct = picked === ANSWER;

  return (
    <div className="sample">
      <div className="sample__bar">
        <span className="u-eyebrow">Sliding window &middot; a real question</span>
      </div>

      <div className="sample__body">
        <p className="sample__prompt">
          You are finding the longest substring with no repeated characters. The window has just
          taken in a character it already contains. What has to happen next?
        </p>

        <div className="choice-group" role="radiogroup" aria-label="Answer options">
          {OPTIONS.map((option, index) => (
            <Choice
              key={option}
              name="landing-sample"
              checked={picked === index}
              onSelect={() => setPicked(index)}
            >
              {option}
            </Choice>
          ))}
        </div>

        {/* aria-live so the verdict is announced rather than only seen. */}
        <div className="sample__verdict" aria-live="polite">
          {answered ? (
            <>
              <p className={correct ? 'sample__result sample__result--right' : 'sample__result'}>
                {correct ? 'Right.' : 'Not this time.'}
              </p>
              <p className="sample__why">
                The invariant is &ldquo;no repeats inside the window&rdquo;. The moment one appears
                you shrink from the left until it is gone — growing from the right first would
                measure a window that is already invalid.
              </p>
              <p className="u-muted sample__after">
                In the pilot you would see this again in a few days, then again after a week or two.
                That gap is the part that does the work.
              </p>
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
