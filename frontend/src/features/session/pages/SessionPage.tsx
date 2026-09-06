import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, CheckCircle, ChevronDown, ConfidenceTap, Prose, QuestionCard } from '@learnos/ui';
import type { Confidence, PublicItem, SessionResponse } from '@learnos/shared';
import { useSubmitReviewMutation } from '../../reviews/reviewsApi';
import { useCompleteSessionMutation, useSessionQuery } from '../sessionApi';

type Rating = NonNullable<Confidence>;
type NewConcept = SessionResponse['newConcepts'][number];

/**
 * One session is a queue: the new concepts, then the reviews that are due
 * (T-073).
 *
 * The reviews used to be fetched, counted in the header — "then 6 reviews" —
 * and never asked. That left the web session teaching without ever practising
 * retrieval, which is the mechanism the whole product rests on (plan.md §3.2),
 * and left the FSRS schedule those answers drive standing still.
 */
type Step =
  | { kind: 'concept'; key: string; concept: NewConcept }
  | { kind: 'review'; key: string; item: PublicItem };

function buildSteps(data: SessionResponse): Step[] {
  return [
    ...data.newConcepts.map(
      (concept): Step => ({ kind: 'concept', key: `concept:${concept.conceptId}`, concept }),
    ),
    // After the new concepts, not before: teaching is what the day is paced
    // around, so a learner who runs out of time should lose a review rather
    // than the concept the schedule expected them to be taught today.
    ...data.dueReviews.map((item): Step => ({ kind: 'review', key: `review:${item.itemId}`, item })),
  ];
}

/**
 * Roughly what is left, in minutes — the same weights the server's planner uses
 * to size the session in the first place (`lib/planner.ts`), so the number the
 * learner sees agrees with the budget the session was built to.
 */
const SECONDS_PER_CONCEPT = 180;
const SECONDS_PER_REVIEW = 45;

export function minutesLeft(conceptsLeft: number, reviewsLeft: number): number {
  const seconds = conceptsLeft * SECONDS_PER_CONCEPT + reviewsLeft * SECONDS_PER_REVIEW;
  return Math.max(1, Math.round(seconds / 60));
}

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
  const [reviewed, setReviewed] = useState(0);
  const [done, setDone] = useState(false);

  const steps = useMemo(() => (data ? buildSteps(data) : []), [data]);
  const step = steps[index];
  const teachMode = step?.kind === 'concept' ? step.concept.teachMode : null;

  const shownAt = useRef(Date.now());
  useEffect(() => {
    shownAt.current = Date.now();
    setAttempt('');
    // A review is a bare question, so nothing is withheld. For a new concept,
    // example_first shows the explanation immediately and try_first withholds
    // it until an attempt has been made — that difference is the whole A/B.
    setRevealed(teachMode === null || teachMode === 'example_first');
    setReadMore(false);
    setResponse(null);
    setConfidence(null);
    setVerdict(null);
  }, [step?.key, teachMode]);

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

  if (done || !step) {
    const didSomething = taught.length > 0 || reviewed > 0;
    return (
      <div className="u-stack u-stack--loose u-measure">
        <h1>{didSomething ? 'That’s today done' : 'Nothing due today'}</h1>
        <div className="summary-stat">
          <div>
            <div className="summary-stat__value">{taught.length}</div>
            <div className="summary-stat__label">locked in</div>
          </div>
          <div>
            {/* What was actually answered, not what was offered. This used to
                read "reviews waiting" over the number the session had been
                handed — which stayed on screen unchanged even though the
                reviews were never asked. */}
            <div className="summary-stat__value">{reviewed}</div>
            <div className="summary-stat__label">
              {reviewed === 1 ? 'review done' : 'reviews done'}
            </div>
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

  const item = step.kind === 'concept' ? step.concept.item : step.item;
  const correction = step.kind === 'concept' && revealed ? matchCorrection(step.concept, attempt) : null;
  const canAnswer = response !== null && response !== '' && confidence !== null;

  const remaining = steps.slice(index + 1);
  const conceptsLeft = remaining.filter((s) => s.kind === 'concept').length;
  const reviewsLeft = remaining.filter((s) => s.kind === 'review').length;

  const conceptCount = data.newConcepts.length;
  const reviewCount = data.dueReviews.length;

  function advance() {
    if (step?.kind === 'concept') setTaught((prev) => [...prev, step.concept.conceptId]);
    else setReviewed((prev) => prev + 1);
    // Past the last step, `step` is undefined and the summary renders — no
    // separate "finished" flag needed.
    setIndex(index + 1);
  }

  /** One answer, from either kind of step. `web` for both: the extension is
   *  the only thing that writes `extension` (T-035). */
  function answer(value: string | number | null, rating: Rating | null) {
    return submitReview({
      itemId: item.itemId,
      response: value,
      confidence: rating,
      latencyMs: Date.now() - shownAt.current,
      surface: 'web',
    }).unwrap();
  }

  return (
    <div className="u-stack u-stack--loose">
      <p className="u-eyebrow">
        {step.kind === 'concept'
          ? `Concept ${index + 1} of ${conceptCount}${reviewCount > 0 ? ` · then ${reviewCount} reviews` : ''}`
          : `Review ${index - conceptCount + 1} of ${reviewCount}`}
      </p>

      {step.kind === 'concept' ? (
        <>
          {/* The concept's own name. Without it the learner reads three cards of
              prose with no idea what the idea is called — and the map, the
              extension and the day-30 test all name it. */}
          <p className="u-eyebrow u-eyebrow--strong">New concept · {step.concept.title}</p>

          <div className="teach">
            {/* TRY FIRST — productive failure (plan.md §3.5). Withheld for
                example_first, where the worked explanation comes first instead. */}
            {step.concept.teachMode === 'try_first' && step.concept.tryFirstPrompt ? (
              <div className="teach__card">
                <p className="teach__label">
                  {revealed ? (
                    <>
                      <CheckCircle className="teach__label-icon" />
                      Your attempt
                    </>
                  ) : (
                    'Have a go first'
                  )}
                </p>
                <p className="teach__prompt">{step.concept.tryFirstPrompt}</p>
                {revealed ? (
                  <p className="teach__attempt">
                    {attempt || <span className="u-muted">You skipped this one.</span>}
                  </p>
                ) : (
                  <div className="u-stack teach__attempt-form">
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
                <Prose className="teach__prose" text={correction.why} />
              </div>
            ) : null}

            {revealed ? (
              <>
                <div className="teach__card">
                  <p className="teach__label">How to hold it</p>
                  <Prose
                    className="teach__prose"
                    text={readMore ? step.concept.explanationLong : step.concept.explanationShort}
                  />
                  {!readMore ? (
                    <button type="button" className="teach__more" onClick={() => setReadMore(true)}>
                      Read more
                      <ChevronDown />
                    </button>
                  ) : null}
                </div>

                <Retrieval
                  label="Now without looking"
                  item={item}
                  response={response}
                  onResponse={setResponse}
                  confidence={confidence}
                  onConfidence={setConfidence}
                  verdict={verdict}
                />
              </>
            ) : null}
          </div>
        </>
      ) : (
        <div className="teach">
          {/* No teaching, no explanation, no chance to read it again first:
              this is the retrieval itself, days after the concept was taught,
              and the gap is what makes it worth anything. */}
          <Retrieval
            label="From an earlier day"
            item={item}
            response={response}
            onResponse={setResponse}
            confidence={confidence}
            onConfidence={setConfidence}
            verdict={verdict}
          />
        </div>
      )}

      {revealed ? (
        <div className="session-actions">
          <div className="u-row">
            {verdict ? (
              <Button onClick={advance}>Next</Button>
            ) : (
              <>
                <Button
                  disabled={!canAnswer}
                  onClick={async () => {
                    const result = await answer(response, confidence);
                    setVerdict({ correct: result.correct, feedback: result.feedback });
                  }}
                >
                  Check
                </Button>
                {/* Recorded, not silently dropped: a skipped retrieval is a
                    real data point (no answer, no scheduling) and pretending it
                    did not happen would bias the calibration numbers. */}
                <Button
                  variant="quiet"
                  onClick={async () => {
                    await answer(null, null);
                    advance();
                  }}
                >
                  Skip this one
                </Button>
              </>
            )}
          </div>
          <p className="session-actions__left">~{minutesLeft(conceptsLeft, reviewsLeft)} min left</p>
        </div>
      ) : null}
    </div>
  );
}

interface RetrievalProps {
  label: string;
  item: PublicItem;
  response: string | number | null;
  onResponse: (value: string | number) => void;
  confidence: Rating | null;
  onConfidence: (value: Rating) => void;
  verdict: { correct: boolean | null; feedback: string | null } | null;
}

/**
 * The moment of retrieval, inverted so it reads as a different kind of moment
 * from the reading above it.
 *
 * Shared by both step kinds deliberately: a review *is* the same act as the
 * check after teaching, only with a gap in front of it, and two near-copies
 * would drift apart the day one of them gained a field.
 */
function Retrieval({ label, item, response, onResponse, confidence, onConfidence, verdict }: RetrievalProps) {
  return (
    <div className="teach__card teach__card--retrieval">
      <p className="teach__label teach__label--invert">{label}</p>
      <QuestionCard item={item} value={response} onChange={onResponse} />
      {verdict ? (
        <p className={`verdict${verdict.correct ? ' verdict--right' : ''}`}>
          {verdict.correct ? 'Right.' : 'Not this time.'} {verdict.feedback}
        </p>
      ) : (
        <div className="teach__confidence">
          <ConfidenceTap value={confidence} onChange={onConfidence} />
        </div>
      )}
    </div>
  );
}
