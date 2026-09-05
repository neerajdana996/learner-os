import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
}

export function Field({ label, hint, error, style, ...rest }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <label htmlFor={id} style={{ fontSize: 13, fontWeight: 500 }}>
        {label}
      </label>
      <input
        {...rest}
        id={id}
        aria-invalid={error ? true : undefined}
        // Both are announced, so a learner using a screen reader gets the rule
        // and the failure rather than just "invalid".
        aria-describedby={[hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined}
        style={{
          font: 'inherit',
          fontSize: 15,
          background: 'var(--surface)',
          border: `1px solid ${error ? 'var(--clay)' : 'var(--border-strong)'}`,
          borderRadius: 'var(--radius)',
          padding: '0 14px',
          minHeight: 'var(--tap)',
          color: 'var(--ink)',
          ...style,
        }}
      />
      {hint ? (
        <div id={hintId} style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--muted)' }}>
          {hint}
        </div>
      ) : null}
      {error ? (
        <div id={errorId} role="alert" style={{ fontSize: 12.5, color: 'var(--clay-ink)' }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
