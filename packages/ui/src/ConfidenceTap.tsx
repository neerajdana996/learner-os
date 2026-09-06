import type { Confidence } from '@learnos/shared';
import { Choice } from './Choice.js';

type Rating = NonNullable<Confidence>;

const OPTIONS: { value: Rating; label: string }[] = [
  { value: 'guess', label: 'Guessing' },
  { value: 'think', label: 'Fairly sure' },
  { value: 'sure', label: 'Certain' },
];

export interface ConfidenceTapProps {
  value: Rating | null;
  onChange: (value: Rating) => void;
  /**
   * When the question is being asked.
   *
   * `'before'` — the web session asks ahead of the answer, where it is required
   * and the present tense is correct.
   *
   * `'after'` — the extension asks once the verdict is already on screen
   * (T-029). "How sure are you?" makes no sense there, and neither does
   * "required", since the answer is already recorded. Same measurement, and it
   * has to be worded as a memory of a moment that has passed.
   */
  asked?: 'before' | 'after';
}

/**
 * Required before every answer, and never pre-selected.
 *
 * A default would silently become data — and how often "certain" was actually
 * right is one of the numbers the pilot exists to measure (plan.md §3.6), so an
 * untapped answer must stay distinguishable from a real one.
 */
export function ConfidenceTap({ value, onChange, asked = 'before' }: ConfidenceTapProps) {
  const after = asked === 'after';
  return (
    <fieldset className="u-stack u-stack--tight">
      <legend className="field__label">
        {after ? 'Before you saw the answer, how sure were you?' : 'How sure are you?'}
      </legend>
      {after ? null : (
        <p className="field__hint">
          Required — and we’ll show you at the end how often “certain” was actually right.
        </p>
      )}
      <div className="choice-group choice-group--inline">
        {OPTIONS.map((option) => (
          <Choice
            key={option.value}
            name="confidence"
            checked={value === option.value}
            onSelect={() => onChange(option.value)}
            inline
          >
            {option.label}
          </Choice>
        ))}
      </div>
    </fieldset>
  );
}
