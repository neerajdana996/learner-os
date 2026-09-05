import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../../components/Button';
import { ConfidenceTap } from '../../../components/ConfidenceTap';
import { QuestionCard } from '../../../components/QuestionCard';
import type { Confidence, SessionResponse } from '../../../shared';
import { useSubmitReviewMutation } from '../../reviews/reviewsApi';
import { useCompleteSessionMutation, useSessionQuery } from '../sessionApi';

type Rating = NonNullable<Confidence>;
type NewConcept = SessionResponse['newConcepts'][number];

/** Loose match, on purpose: this picks which prepared correction to show, it
 *  does not grade anything. Grading is server-side and lives in one place. */
function matchCorrection(concept: NewConcept, attempt: string) {
  const normalised = attempt.trim().toLowerCase();
  if (!normalised) return null;
  return (
    concept.corrections.find((c) =>
      c.wrong
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 4)
        .some((w) => normalised.includes(w)),
    ) ?? null
  );
}

export default function SessionPage() {
  const { data, isLoading } = useSessionQuery();
  const [submitReview] = useSubmitReviewMutation();
  const [complete, { isLoading: completing }] = useCompleteSessionMutation();

  const [index, setIndex] = useState(0);
  const [attempt, setAttempt] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [readMore, setReadMore] = useState(false);
  const [response, setResponse] = useState<string | number | null>(null);
  const [confidence, setConfidence] = useState<Rating | null>(null);
  const [verdict, setVerdict] = useState<{ correct: boolean | null; feedback: string | null } | null>(null);
  const [taught, setTaught] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  const concept = data?.newConcepts[index];
  const shownAt = useRef(Date.now());
  useEffect(() => {
    shownAt.current = Date.now();
    setAttempt('');
    // example_first shows the explanation immediately; try_first withholds it
    // until an attempt has been made. That difference is the whole A/B.
    setRevealed(concept?.teachMode === 'example_first');
    setReadMore(false);
    setResponse(null);
    setConfidence(null);
    setVerdict(null);
  }, [concept?.conceptId, concept?.teachMode]);

  if (isLoading || !data) return <p className="u-muted">Loading…</p>;

  if (data.completedToday && !done) {
    return (
      <div className="u-stack u-measure">
        <h1>Done for today</h1>
        <p className="u-muted">
          Come back tomorrow. Anything you missed stays in the queue — nothing is lost.
        </p>
        <div>
          <Link className="btn btn--secondary" to="/map">
            See your map
          </Link>
        </div>
      </div>
    );
  }

  if (done || !concept) {
    return (
      <div className="u-stack u-stack--loose u-measure">
        <h1>{taught.length > 0 ? 'That’s today done' : 'Nothing due today'}</h1>
        <div className="summary-stat">
          <div>
            <div className="summary-stat__value">{taught.length}</div>
            <div className="summary-stat__label">locked in</div>
          </div>
          <div>
            <div className="summary-stat__value">{data.dueReviews.length}</div>
            <div className="summary-stat__label">reviews waiting</div>
          </div>
        </div>
        <p className="u-muted">
          You&rsquo;ll see these again over the next few days, at gaps chosen to be just long enough
          to be hard.
        </p>
        <div className="u-row">
          <Button
            disabled={completing}
            onClick={async () => {
              await complete(taught).unwrap();
              setDone(true);
            }}
          >
            {completing ? 'Saving…' : 'Finish'}
          </Button>
          <Link className="btn btn--quiet" to="/map">
            See your map
          </Link>
        </div>
      </div>
    );
  }

  const correction = revealed ? matchCorrection(concept, attempt) : null;
  const canAnswer = response !== null && response !== '' && confidence !== null;

  return (
    <div className="u-stack u-stack--loose">
      <p className="u-eyebrow">
        Concept {index + 1} of {data.newConcepts.length} · then {data.dueReviews.length} reviews
      </p>

      <div className="teach">
        {/* TRY FIRST — productive failure (plan.md §3.5). Withheld for
            example_first, where the worked explanation comes first instead. */}
        {concept.teachMode === 'try_first' && concept.tryFirstPrompt ? (
          <div className="teach__card">
            <p className="teach__label">Have a go first</p>
            <p className="teach__prompt">{concept.tryFirstPrompt}</p>
            {revealed ? (
              <p className="teach__attempt" style={{ marginTop: 16 }}>
                {attempt || <span className="u-muted">You skipped this one.</span>}
              </p>
            ) : (
              <div className="u-stack" style={{ marginTop: 16 }}>
                <textarea
                  className="field__textarea"
                  rows={3}
                  aria-label="Your attempt"
                  placeholder="Guess. Getting it wrong is what makes the answer stick."
                  value={attempt}
                  onChange={(e) => setAttempt(e.target.value)}
                />
                <div className="u-row">
                  <Button onClick={() => setRevealed(true)}>Show me</Button>
                  <Button variant="quiet" onClick={() => setRevealed(true)}>
                    I don&rsquo;t know
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {correction ? (
          <div className="teach__card teach__card--correction">
            <p className="teach__label teach__label--warn">A common way to read it</p>
            <p className="teach__prose">{correction.why}</p>
          </div>
        ) : null}

        {revealed ? (
          <>
            <div className="teach__card">
              <p className="teach__label">How to hold it</p>
              <p className="teach__prose">
                {readMore ? concept.explanationLong : concept.explanationShort}
              </p>
              {!readMore ? (
                <button type="button" className="teach__more" onClick={() => setReadMore(true)}>
                  Read more
                </button>
              ) : null}
            </div>

            <div className="teach__card teach__card--retrieval">
              <p className="teach__label teach__label--invert">Now without looking</p>
              <QuestionCard item={concept.item} value={response} onChange={setResponse} />
              {verdict ? (
                <p className={`verdict${verdict.correct ? ' verdict--right' : ''}`}>
                  {verdict.correct ? 'Right.' : 'Not this time.'} {verdict.feedback}
                </p>
              ) : (
                <div style={{ marginTop: 20 }}>
                  <ConfidenceTap value={confidence} onChange={setConfidence} />
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>

      {revealed ? (
        <div className="u-row">
          {verdict ? (
            <Button
              onClick={() => {
                setTaught((prev) => [...prev, concept.conceptId]);
                // Past the last concept, `concept` is undefined and the summary
                // renders — no separate "finished" flag needed.
                setIndex(index + 1);
              }}
            >
              Next
            </Button>
          ) : (
            <Button
              disabled={!canAnswer}
              onClick={async () => {
                const result = await submitReview({
                  itemId: concept.item.itemId,
                  response,
                  confidence,
                  latencyMs: Date.now() - shownAt.current,
                  surface: 'web',
                }).unwrap();
                setVerdict({ correct: result.correct, feedback: result.feedback });
              }}
            >
              Check
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
