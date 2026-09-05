import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
}

export function Field({ label, hint, error, className, ...rest }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <div className={['field', error && 'field--invalid', className].filter(Boolean).join(' ')}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        {...rest}
        id={id}
        className="field__input"
        aria-invalid={error ? true : undefined}
        // Both are announced, so a learner using a screen reader gets the rule
        // and the failure rather than just "invalid".
        aria-describedby={[hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined}
      />
      {hint ? (
        <div className="field__hint" id={hintId}>
          {hint}
        </div>
      ) : null}
      {error ? (
        <div className="field__error" id={errorId} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
