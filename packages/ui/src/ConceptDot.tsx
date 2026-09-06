import type { ConceptState } from '@learnos/shared';

const LABELS: Record<ConceptState, string> = {
  known: 'Already knew it',
  taught: 'Solid',
  untaught: 'Not taught yet',
  heldout: 'Held back',
};

/**
 * Concept state as a dot — and never by hue alone.
 *
 * The map leans on green versus amber, which is precisely the pair ~8% of men
 * cannot separate. So fill level carries the same information: full, half,
 * hollow, dashed. Every use also renders the written label nearby; this is
 * shorthand, not the only signal.
 */
export function ConceptDot({ state, atRisk }: { state: ConceptState; atRisk?: boolean }) {
  const label = atRisk ? 'Slipping' : LABELS[state];

  return (
    <svg width="14" height="14" viewBox="0 0 14 14" role="img" aria-label={label}>
      {state === 'heldout' ? (
        <circle cx="7" cy="7" r="6" fill="none" stroke="var(--stone)" strokeWidth="1.5" strokeDasharray="2.5 2.5" />
      ) : state === 'untaught' ? (
        <circle cx="7" cy="7" r="6" fill="none" stroke="var(--stone)" strokeWidth="1.5" />
      ) : atRisk ? (
        <>
          <path d="M1 7a6 6 0 0 1 12 0z" fill="var(--ochre)" />
          <circle cx="7" cy="7" r="6" fill="none" stroke="var(--ochre)" strokeWidth="1.5" />
        </>
      ) : (
        <circle cx="7" cy="7" r="6" fill="var(--sage)" />
      )}
    </svg>
  );
}

export function ConceptLegend({ counts }: { counts: Record<string, number> }) {
  const items: { state: ConceptState; atRisk?: boolean; label: string; key: string }[] = [
    { state: 'taught', label: 'Solid', key: 'solid' },
    { state: 'taught', atRisk: true, label: 'Slipping', key: 'risk' },
    { state: 'untaught', label: 'Not taught yet', key: 'untaught' },
    { state: 'heldout', label: 'Held back', key: 'heldout' },
  ];

  return (
    <div className="legend">
      {items.map((item) => (
        <span className="legend__item" key={item.key}>
          <ConceptDot state={item.state} atRisk={item.atRisk} />
          {item.label} · {counts[item.key] ?? 0}
        </span>
      ))}
    </div>
  );
}
