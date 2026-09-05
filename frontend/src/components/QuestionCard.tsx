import type { PublicItem } from '../shared';
import { Choice } from './Choice';

export interface QuestionCardProps {
  item: PublicItem;
  value: string | number | null;
  onChange: (value: string | number) => void;
}

/**
 * Renders any item type from its `type` field, so a question looks the same in
 * the diagnostic, the session and the day-30 test. The payload never carries an
 * answer key — the server strips it (T-010) — so there is nothing here to leak.
 */
export function QuestionCard({ item, value, onChange }: QuestionCardProps) {
  return (
    <div>
      <h1 className="question__prompt">{item.prompt}</h1>

      {item.type === 'recognition' && item.options ? (
        <fieldset>
          <legend className="u-sr-only">Choose an answer</legend>
          <div className="choice-group">
            {item.options.map((option, index) => (
              <Choice
                key={option}
                name="answer"
                checked={value === index}
                onSelect={() => onChange(index)}
              >
                {option}
              </Choice>
            ))}
          </div>
        </fieldset>
      ) : (
        <textarea
          className="field__textarea"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          rows={item.type === 'explain' ? 5 : 2}
          aria-label="Your answer"
          placeholder={item.type === 'explain' ? 'In your own words…' : 'Your answer'}
        />
      )}
    </div>
  );
}
