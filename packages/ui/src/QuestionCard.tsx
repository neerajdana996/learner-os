import type { PublicItem } from '@learnos/shared';
import { BlockList } from './blocks/BlockList.js';
import { ClozeCode } from './blocks/ClozeCode.js';
import { HotspotLine } from './blocks/HotspotLine.js';
import { Choice } from './Choice.js';

export interface QuestionCardProps {
  item: PublicItem;
  value: string | number | null;
  onChange: (value: string | number) => void;
}

/**
 * Renders any item type from its `type` field, so a question looks the same in
 * the diagnostic, the session and the day-30 test. The payload never carries an
 * answer key — the server strips it (T-010) — so there is nothing here to leak.
 *
 * One branch for blocks (T-085): an item that carries them shows them between
 * the prompt and the answer surface, and an item that does not renders exactly
 * as it did before, which is every item generated so far.
 */
export function QuestionCard({ item, value, onChange }: QuestionCardProps) {
  /**
   * An answer block replaces the default surface, whatever the item's `type`
   * (T-108). `numeric` is the one implemented; the four code answer surfaces
   * arrive in T-086–T-088 and until then fall through to the text box below,
   * which is degraded but answerable rather than a dead end.
   */
  const answerBlock = item.blocks?.find((b) => b.slot === 'answer');

  return (
    <div>
      <h1 className="question__prompt">{item.prompt}</h1>

      {item.blocks ? <BlockList blocks={item.blocks} /> : null}

      {answerBlock?.kind === 'clozeCode' ? (
        <ClozeCode
          block={answerBlock}
          value={typeof value === 'string' ? value : ''}
          onChange={onChange}
        />
      ) : answerBlock?.kind === 'hotspotLine' ? (
        <HotspotLine
          block={answerBlock}
          value={typeof value === 'number' ? value : null}
          onChange={onChange}
        />
      ) : answerBlock?.kind === 'numeric' ? (
        /* A number, not prose. Grading compares it against the block's own
           tolerance, so an estimate is judged as an estimate — and the unit is
           shown beside the field rather than typed, because asking someone to
           write "GB" and then grading the string is a spelling test. */
        <div className="field numeric">
          <label className="field__label" htmlFor="numeric-answer">
            Your answer
          </label>
          <div className="numeric__row">
            <input
              id="numeric-answer"
              className="field__input"
              type="number"
              inputMode="decimal"
              step="any"
              value={typeof value === 'number' || typeof value === 'string' ? value : ''}
              onChange={(e) => onChange(e.target.value)}
              placeholder="A number"
            />
            {answerBlock.unit ? <span className="numeric__unit">{answerBlock.unit}</span> : null}
          </div>
        </div>
      ) : item.type === 'recognition' && item.options ? (
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
      ) : item.type === 'explain' ? (
        <textarea
          className="field__textarea"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          rows={5}
          aria-label="Your answer"
          placeholder="In your own words…"
        />
      ) : (
        /* `recall` and `application` want one short answer. A textarea invited
           a paragraph and wasted a third of a 380×300 popup on empty rows;
           an input also gets Enter-to-submit for free. */
        <input
          className="field__input"
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Your answer"
          placeholder="Your answer"
          autoComplete="off"
        />
      )}
    </div>
  );
}
