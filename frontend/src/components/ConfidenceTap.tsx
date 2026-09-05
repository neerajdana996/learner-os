import type { Confidence } from '../shared';

type Rating = NonNullable<Confidence>;

const OPTIONS: { value: Rating; label: string }[] = [
  { value: 'guess', label: 'Guessing' },
  { value: 'think', label: 'Fairly sure' },
  { value: 'sure', label: 'Certain' },
];

export interface ConfidenceTapProps {
  value: Rating | null;
  onChange: (value: Rating) => void;
}

/**
 * Required before every answer, and never pre-selected.
 *
 * A default would silently become data — and how often "certain" was actually
 * right is one of the numbers the pilot exists to measure (plan.md §3.6), so an
 * untapped answer must be distinguishable from a real one.
 */
export function ConfidenceTap({ value, onChange }: ConfidenceTapProps) {
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      <legend style={{ fontSize: 14, fontWeight: 500, padding: 0, marginBottom: 4 }}>
        How sure are you?
      </legend>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 15, lineHeight: 1.55 }}>
        Required — and we’ll show you at the end how often “certain” was actually right.
      </div>
      <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
        {OPTIONS.map((option) => {
          const selected = value === option.value;
          return (
            <label
              key={option.value}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 'var(--tap)',
                padding: '0 22px',
                fontSize: 14,
                fontWeight: selected ? 500 : 400,
                cursor: 'pointer',
                borderRadius: 'var(--radius)',
                border: `${selected ? 1.5 : 1}px solid ${selected ? 'var(--clay)' : 'var(--border-strong)'}`,
                background: selected ? 'var(--clay-wash)' : 'transparent',
                color: selected ? 'var(--clay-ink)' : 'var(--ink)',
              }}
            >
              <input
                type="radio"
                name="confidence"
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
