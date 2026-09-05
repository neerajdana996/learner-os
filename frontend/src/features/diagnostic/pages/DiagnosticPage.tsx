import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '../../../components/Button';
import { ConfidenceTap } from '../../../components/ConfidenceTap';
import { QuestionCard } from '../../../components/QuestionCard';
import type { Confidence } from '../../../shared';
import { useAnswerDiagnosticMutation, useDiagnosticNextQuery } from '../diagnosticApi';

type Rating = NonNullable<Confidence>;

export default function DiagnosticPage() {
  const { topicId = '' } = useParams();
  const { data, isLoading } = useDiagnosticNextQuery(topicId, { skip: !topicId });
  const [answer, { isLoading: submitting }] = useAnswerDiagnosticMutation();

  const [response, setResponse] = useState<string | number | null>(null);
  const [confidence, setConfidence] = useState<Rating | null>(null);

  // Latency is measured from when the question is *rendered*, not from mount —
  // it feeds the calibration metrics, so it has to mean the same thing on every
  // surface (T-019).
  const shownAt = useRef<number>(Date.now());
  const questionKey = data && !data.done ? data.item.itemId : null;
  useEffect(() => {
    shownAt.current = Date.now();
    setResponse(null);
    setConfidence(null);
  }, [questionKey]);

  if (isLoading || !data) return <div className="muted">Loading…</div>;

  if (data.done) {
    const { asked, sureCount, sureCorrectCount } = data.summary;
    return (
      <div style={{ maxWidth: 560 }}>
        <h1 style={{ fontSize: 34, marginBottom: 12 }}>That’s the baseline</h1>
        <p style={{ fontSize: 16, color: 'var(--ink-2)', marginBottom: 18 }}>
          {asked} questions. You said you were certain {sureCount} times and were right{' '}
          {sureCorrectCount} of those.
        </p>
        <p style={{ fontSize: 15, color: 'var(--muted)', marginBottom: 26 }}>
          Nothing here counts against you — it just decides what gets taught and what gets skipped.
        </p>
        <Button onClick={() => { window.location.href = '/map'; }}>See your map</Button>
      </div>
    );
  }

  const ready = response !== null && response !== '' && confidence !== null;

  return (
    <div style={{ maxWidth: 620, margin: '0 auto' }}>
      <div className="eyebrow" style={{ marginBottom: 26 }}>
        Question {data.progress.asked + 1} · at most {data.progress.max}
      </div>

      <div
        style={{
          background: 'var(--sunken)',
          borderRadius: 5,
          padding: '14px 17px',
          marginBottom: 30,
          fontSize: 13.5,
          lineHeight: 1.6,
          color: 'var(--ink-2)',
        }}
      >
        Getting these wrong costs you nothing — it just means we teach that part properly rather
        than skipping it.
      </div>

      <QuestionCard item={data.item} value={response} onChange={setResponse} />

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 26, marginTop: 30 }}>
        <ConfidenceTap value={confidence} onChange={setConfidence} />
      </div>

      <div style={{ marginTop: 26 }}>
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
