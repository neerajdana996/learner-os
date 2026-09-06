import type { Mood } from '@learnos/shared';

const OPTIONS: { value: Mood; face: string; label: string }[] = [
  { value: 1, face: '😩', label: 'Rough' },
  { value: 2, face: '😐', label: 'Fine' },
  { value: 3, face: '🙂', label: 'Good' },
];

/**
 * One tap a day (T-032).
 *
 * Asked once per learner-local day, after the first card they actually
 * answered. It exists so that when the answer rate dips in week two there is a
 * column to put beside it, instead of a guess about whether people were busy or
 * the questions got harder.
 *
 * **Three faces, and a word under each.** An emoji alone is not an accessible
 * name — a screen reader reads "weary face", which is a description of a glyph
 * rather than a choice — and the same three faces mean different things to
 * different people. The word is the label; the face is decoration.
 *
 * Never pre-selected, for the same reason as the confidence tap: a default
 * would silently become data.
 */
export function MoodTap({ onChange }: { onChange: (mood: Mood) => void }) {
  return (
    <fieldset className="u-stack u-stack--tight">
      <legend className="field__label">How’s the week going?</legend>
      <div className="mood">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className="mood__pick"
            onClick={() => onChange(option.value)}
          >
            <span className="mood__face" aria-hidden="true">
              {option.face}
            </span>
            <span className="mood__label">{option.label}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
