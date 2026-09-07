import { useParams } from 'react-router-dom';
import type { ConceptResult } from '@learnos/shared';
import { useResultsQuery } from '../resultsApi';

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * What the confidence gap means, in a sentence (T-042).
 *
 * Positive is overconfidence. Both directions are worth saying and neither is a
 * failing — knowing you did not know is a skill, and the point of measuring it
 * is that most people cannot. A gap near zero is the good outcome and gets the
 * plainest sentence, because it deserves no drama.
 */
function calibrationLine(gap: number): string {
  if (gap >= 0.2) {
    return 'You were often surer than you turned out to be. That is the most common pattern, and it is the one worth knowing about — it is what makes people stop revising too early.';
  }
  if (gap <= -0.2) {
    return 'You were harder on yourself than the answers were. You knew more than you thought you did.';
  }
  return 'Your sense of what you knew tracked what you actually knew. That is rarer than it sounds.';
}

function ConceptRow({ concept }: { concept: ConceptResult }) {
  return (
    <li className="results__concept">
      <span className="results__concept-title">{concept.title}</span>
      {concept.heldOut ? <span className="results__tag">never taught</span> : null}
      <span className="results__concept-score">
        {/* A concept the test never asked about is blank, not 0%. */}
        {concept.score === null ? (
          <span className="results__unasked" title="Not asked on the test">
            —
          </span>
        ) : (
          pct(concept.score)
        )}
      </span>
    </li>
  );
}

/**
 * The learner's own results (T-042).
 *
 * The comparison is the whole page. "You remembered 78%" means very little on
 * its own — people improve on their own over a month — and "78% of what we
 * taught, against 31% of what we deliberately did not" is a claim with a
 * control in it. Showing the second number is also the only honest way to show
 * the first.
 *
 * The tone is deliberately flat about what did not stick. This is a list of
 * things someone failed to remember, and a page that congratulates or
 * commiserates would be doing something other than reporting.
 */
export default function ResultsPage() {
  const { topicId } = useParams<{ topicId: string }>();
  const { data, isLoading, error } = useResultsQuery(topicId ?? '', { skip: !topicId });

  if (isLoading) return <p className="results__empty">Loading…</p>;
  if (error || !data) return <p className="results__empty">We couldn’t find those results.</p>;

  // Before the Day-30 test there is nothing to report, and saying so is better
  // than a page of zeros that reads like a bad result.
  if (data.taught === null || data.heldOut === null) {
    return (
      <main className="results">
        <h1 className="results__title">{data.topicTitle}</h1>
        <p className="results__lede">
          Your results appear here once you’ve taken the test. Nothing to show yet.
        </p>
      </main>
    );
  }

  const taughtList = data.concepts.filter((c) => !c.heldOut);
  const heldOutList = data.concepts.filter((c) => c.heldOut);
  const stuck = taughtList.filter((c) => c.score !== null && c.score >= 0.5);
  const slipped = taughtList.filter((c) => c.score !== null && c.score < 0.5);
  // A 25-item test cannot cover 16 concepts. These were taught and simply not
  // asked about — and without a section of their own they would vanish from
  // the page entirely, which reads as though they were never taught at all.
  const unasked = taughtList.filter((c) => c.score === null);

  return (
    <main className="results">
      <h1 className="results__title">{data.topicTitle}</h1>

      <p className="results__headline">
        You remembered <strong>{pct(data.taught)}</strong> of what we taught you, against{' '}
        <strong>{pct(data.heldOut)}</strong> of what we deliberately didn’t.
      </p>
      <p className="results__lede">
        That second number is the honest comparison. People pick things up on their own over a
        month, and without it the first number wouldn’t mean much.
      </p>

      {data.calibrationGap !== null ? (
        <p className="results__calibration">{calibrationLine(data.calibrationGap)}</p>
      ) : null}

      <section className="results__section">
        <h2 className="results__subtitle">What stuck</h2>
        {stuck.length === 0 ? (
          <p className="results__empty">Nothing cleared half this time.</p>
        ) : (
          <ul className="results__list">
            {stuck.map((c) => (
              <ConceptRow key={c.conceptId} concept={c} />
            ))}
          </ul>
        )}
      </section>

      <section className="results__section">
        <h2 className="results__subtitle">What didn’t</h2>
        {slipped.length === 0 ? (
          <p className="results__empty">Everything we taught cleared half.</p>
        ) : (
          <ul className="results__list">
            {slipped.map((c) => (
              <ConceptRow key={c.conceptId} concept={c} />
            ))}
          </ul>
        )}
      </section>

      {unasked.length > 0 ? (
        <section className="results__section">
          <h2 className="results__subtitle">Not asked this time</h2>
          <p className="results__lede">
            We taught these but the test didn’t happen to cover them — it samples, it doesn’t
            examine everything. No result either way.
          </p>
          <ul className="results__list">
            {unasked.map((c) => (
              <ConceptRow key={c.conceptId} concept={c} />
            ))}
          </ul>
        </section>
      ) : null}

      {heldOutList.length > 0 ? (
        <section className="results__section">
          <h2 className="results__subtitle">What we held back</h2>
          <p className="results__lede">
            We never taught these, on purpose. They’re the comparison that makes the rest of this
            page mean something — and they’re yours to learn now.
          </p>
          <ul className="results__list">
            {heldOutList.map((c) => (
              <ConceptRow key={c.conceptId} concept={c} />
            ))}
          </ul>
        </section>
      ) : null}

      {data.day45Pending ? (
        <p className="results__day45">
          We’ll check once more in a couple of weeks, without any reminders in between. That one
          measures what stays without upkeep.
        </p>
      ) : null}
    </main>
  );
}
