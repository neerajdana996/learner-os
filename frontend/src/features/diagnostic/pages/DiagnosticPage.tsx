import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../../components/Button';
import { ConfidenceTap } from '../../../components/ConfidenceTap';
import { QuestionCard } from '../../../components/QuestionCard';
import type { Confidence } from '../../../shared';
import { useAnswerDiagnosticMutation, useDiagnosticNextQuery } from '../diagnosticApi';

type Rating = NonNullable<Confidence>;

export default function DiagnosticPage() {
  const { topicId = '' } = useParams();
  const navigate = useNavigate();
  const { data, isLoading } = useDiagnosticNextQuery(topicId, { skip: !topicId });
  const [answer, { isLoading: submitting }] = useAnswerDiagnosticMutation();

  const [response, setResponse] = useState<string | number | null>(null);
  const [confidence, setConfidence] = useState<Rating | null>(null);

  // Measured from when the question is *rendered*, not from mount — it feeds
  // the calibration metrics, so it has to mean the same thing on every surface.
  const shownAt = useRef<number>(Date.now());
  const questionKey = data && !data.done ? data.item.itemId : null;
  useEffect(() => {
    shownAt.current = Date.now();
    setResponse(null);
    setConfidence(null);
  }, [questionKey]);

  if (isLoading || !data) return <p className="u-muted">Loading…</p>;

  if (data.done) {
    const { asked, sureCount, sureCorrectCount } = data.summary;
    return (
      <div className="u-stack u-measure">
        <h1>That’s the baseline</h1>
        <p>
          {asked} questions. You said you were certain {sureCount} times and were right{' '}
          {sureCorrectCount} of those.
        </p>
        <p className="u-muted">
          Nothing here counts against you — it just decides what gets taught and what gets skipped.
        </p>
        <div>
          <Button onClick={() => navigate('/map')}>See your map</Button>
        </div>
      </div>
    );
  }

  const ready = response !== null && response !== '' && confidence !== null;

  return (
    <div className="u-stack u-stack--loose question-page">
      <div className="u-eyebrow">
        Question {data.progress.asked + 1} · at most {data.progress.max}
      </div>

      <p className="notice">
        Getting these wrong costs you nothing — it just means we teach that part properly rather
        than skipping it.
      </p>

      <QuestionCard item={data.item} value={response} onChange={setResponse} />

      <ConfidenceTap value={confidence} onChange={setConfidence} />

      <div>
        <Button
          disabled={!ready || submitting}
          onClick={() =>
            answer({
              topicId,
              answer: {
                conceptId: data.conceptId,
                itemId: data.item.itemId,
                response,
                confidence,
                latencyMs: Date.now() - shownAt.current,
              },
            })
          }
        >
          {submitting ? 'Saving…' : 'Answer'}
        </Button>
      </div>
    </div>
  );
}
