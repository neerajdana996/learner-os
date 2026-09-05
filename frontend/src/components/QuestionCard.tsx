import type { PublicItem } from '../shared';

export interface QuestionCardProps {
  item: PublicItem;
  value: string | number | null;
  onChange: (value: string | number) => void;
}

/**
 * Renders any item type from its `type` field.
 *
 * One component for the diagnostic, the session and the day-30 test, so a
 * question looks the same wherever a learner meets it. The payload never
 * carries an answer key — the server strips it (T-010) — so there is nothing
 * here that could leak one.
 */
export function QuestionCard({ item, value, onChange }: QuestionCardProps) {
  return (
    <div>
      <h1 className="serif" style={{ fontSize: 30, lineHeight: 1.28, marginBottom: 30 }}>
        {item.prompt}
      </h1>

      {item.type === 'recognition' && item.options ? (
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <legend className="sr-only">Choose an answer</legend>
          {item.options.map((option, index) => {
            const selected = value === index;
            return (
              <label
                key={option}
                style={{
                  background: selected ? 'var(--clay-wash)' : 'var(--surface)',
                  border: `${selected ? 1.5 : 1}px solid ${selected ? 'var(--clay)' : 'var(--border-strong)'}`,
                  borderRadius: 'var(--radius)',
                  padding: '15px 17px',
                  fontSize: 15,
                  lineHeight: 1.5,
                  minHeight: 52,
                  display: 'flex',
                  alignItems: 'center',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="answer"
                  checked={selected}
                  onChange={() => onChange(index)}
                  className="sr-only"
                />
                {option}
              </label>
            );
          })}
        </fieldset>
      ) : (
        <textarea
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          rows={item.type === 'explain' ? 5 : 2}
          aria-label="Your answer"
          placeholder={item.type === 'explain' ? 'In your own words…' : 'Your answer'}
          style={{
            width: '100%',
            font: 'inherit',
            fontSize: 15,
            lineHeight: 1.6,
            background: 'var(--surface)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius)',
            padding: '13px 14px',
            color: 'var(--ink)',
            resize: 'vertical',
          }}
        />
      )}
    </div>
  );
}
