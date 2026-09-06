import { useParams } from 'react-router-dom';
import { ConceptDot, ConceptLegend } from '../../../components/ConceptDot';
import type { MapConcept } from '../../../shared';
import { useTopicsQuery } from '../../topics/topicsApi';
import { useMapQuery } from '../mapApi';

/** Groups of five by teaching order — a layered list, deliberately not a force
 *  graph: it has to be readable on a phone, and order is the only axis that
 *  carries meaning here. */
const LAYER_SIZE = 5;

function layerName(index: number, total: number): string {
  if (index === 0) return 'Foundations';
  if (index === total - 1) return 'Still ahead';
  return `Part ${index + 1}`;
}

/** Which day of the course this is — "day 12 of 30" in the design. Null until
 *  the topic has both dates, which is every topic created through onboarding. */
export function courseDay(
  startsAt: string | null | undefined,
  endsAt: string | null | undefined,
  now = Date.now(),
): { day: number; total: number } | null {
  if (!startsAt || !endsAt) return null;
  const start = new Date(startsAt).getTime();
  const total = Math.round((new Date(endsAt).getTime() - start) / 86_400_000);
  if (total <= 0) return null;
  // Day 1 is the day you started, not day 0 — nobody counts their first day as
  // zero, and "day 0 of 30" reads as though nothing has begun.
  const day = Math.min(total, Math.max(1, Math.floor((now - start) / 86_400_000) + 1));
  return { day, total };
}

export default function MapPage() {
  const { topicId: paramId } = useParams();
  // Always fetched, not just as a fallback for a missing id: the header needs
  // the topic's dates, and the query is shared cache with the dashboard.
  const { data: topics } = useTopicsQuery();
  const topicId = paramId ?? topics?.topics[0]?.id ?? '';

  const { data, isLoading } = useMapQuery(topicId, { skip: !topicId });

  if (isLoading || !data) return <p className="u-muted">Loading…</p>;

  const counts = {
    solid: data.concepts.filter((c) => (c.state === 'taught' || c.state === 'known') && !c.atRisk).length,
    risk: data.concepts.filter((c) => c.atRisk).length,
    untaught: data.concepts.filter((c) => c.state === 'untaught').length,
    heldout: data.concepts.filter((c) => c.state === 'heldout').length,
  };

  const atRisk = data.concepts.filter((c) => c.atRisk);

  const layers: MapConcept[][] = [];
  for (let i = 0; i < data.concepts.length; i += LAYER_SIZE) {
    layers.push(data.concepts.slice(i, i + LAYER_SIZE));
  }

  return (
    <div className="u-stack u-stack--loose">
      {/* The score and the day counter are in the bar on every screen now
          (T-081); repeating them here was the same number twice. What is left
          is what to act on. */}
      {atRisk.length > 0 ? (
        <div className="at-risk u-measure">
          <p className="at-risk__title">
            {atRisk.length === 1 ? 'One is slipping' : `${atRisk.length} are slipping`}
          </p>
          <p className="at-risk__body">
            {atRisk.map((c) => c.title).filter(Boolean).join(', ')}. Today&rsquo;s session puts
            {atRisk.length === 1 ? ' it' : ' them'} back in front of you.
          </p>
        </div>
      ) : null}

      <ConceptLegend counts={counts} />

      <div className="layers">
        {layers.map((layer, index) => (
          <div key={index}>
            <p className="layers__title">{layerName(index, layers.length)}</p>
            <div className="u-stack u-stack--tight">
              {layer.map((concept) => (
                <div
                  key={concept.conceptId}
                  className={[
                    'concept',
                    concept.atRisk && 'concept--risk',
                    (concept.state === 'untaught' || concept.state === 'heldout') && 'concept--quiet',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <ConceptDot state={concept.state} atRisk={concept.atRisk} />
                  <span className="concept__name">
                    {/* Keyed off state, not off a null title: fail-closed, so a
                        server that ever started sending one still shows "?". */}
                    {concept.state === 'heldout' ? (
                      <span className="u-muted">Held back until day 30</span>
                    ) : (
                      concept.title
                    )}
                  </span>
                  <span
                    className={[
                      'concept__value',
                      concept.atRisk && 'concept__value--risk',
                      concept.state === 'untaught' && 'concept__value--none',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {concept.state === 'heldout' ? '?' : concept.state === 'untaught' ? '—' : concept.mastery.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {counts.heldout > 0 ? (
        <p className="notice u-measure">
          <strong>Why {counts.heldout === 1 ? 'one is' : `${counts.heldout} are`} hidden.</strong> We
          never teach these, and on day 30 you&rsquo;ll be tested on them alongside everything else.
          The difference between the two scores is how we know the teaching did anything at all.
        </p>
      ) : null}
    </div>
  );
}
