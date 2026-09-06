import type { ReactNode } from 'react';

export interface ChoiceProps {
  name: string;
  checked: boolean;
  onSelect: () => void;
  children: ReactNode;
  /** Compact pill form, for the confidence tap. */
  inline?: boolean;
}

/**
 * A radio wrapped in a selectable card. The topic picker, answer options and
 * the confidence tap are the same control at different sizes, so they share one
 * implementation rather than three near-copies that drift.
 */
export function Choice({ name, checked, onSelect, children, inline }: ChoiceProps) {
  return (
    <label
      className={['choice', inline && 'choice--inline', checked && 'choice--selected']
        .filter(Boolean)
        .join(' ')}
    >
      <input type="radio" name={name} checked={checked} onChange={onSelect} />
      {children}
    </label>
  );
}
