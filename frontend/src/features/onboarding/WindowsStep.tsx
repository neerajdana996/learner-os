import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { ActiveWindowsSchema, type ActiveWindow } from '@learnos/shared';

export interface WindowsStepProps {
  timezone: string;
  windows: ActiveWindow[];
  onChange: (windows: ActiveWindow[]) => void;
}

const MAX_WINDOWS = 3;

/**
 * The consent moment. This is the only screen where the learner decides when a
 * piece of software may interrupt their day, so it is worth its own step rather
 * than a row on a settings form.
 *
 * Validated with the shared schema, which is the same one the API enforces and
 * the extension will read — no second copy of the rules.
 */
export function WindowsStep({ timezone, windows, onChange }: WindowsStepProps) {
  const result = ActiveWindowsSchema.safeParse(windows);
  const issues = result.success ? [] : result.error.issues;
  const issueFor = (index: number) =>
    issues.find((issue) => issue.path[0] === index)?.message ?? null;
  const listIssue = issues.find((issue) => issue.path.length === 0)?.message ?? null;

  function update(index: number, patch: Partial<ActiveWindow>) {
    onChange(windows.map((w, i) => (i === index ? { ...w, ...patch } : w)));
  }

  return (
    <>
      <div className="u-stack u-stack--tight">
        {windows.map((window, index) => (
          <div className="window-row" key={index}>
            <Field
              label={index === 0 ? 'From' : ''}
              type="time"
              value={window.start}
              onChange={(e) => update(index, { start: e.target.value })}
            />
            <span className="window-row__to">to</span>
            <Field
              label={index === 0 ? 'Until' : ''}
              type="time"
              value={window.end}
              onChange={(e) => update(index, { end: e.target.value })}
              error={issueFor(index)}
            />
            <button
              type="button"
              className="window-row__remove"
              aria-label={`Remove window ${index + 1}`}
              onClick={() => onChange(windows.filter((_, i) => i !== index))}
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {listIssue ? (
        <p className="field__error" role="alert">
          {listIssue}
        </p>
      ) : null}

      {windows.length < MAX_WINDOWS ? (
        <div>
          <Button
            variant="secondary"
            onClick={() => onChange([...windows, { start: '19:00', end: '21:00' }])}
          >
            Add another window
          </Button>
        </div>
      ) : null}

      <p className="field__hint">
        Times are in <strong>{timezone}</strong>. A window can’t cross midnight — if you study late,
        add two.
      </p>
    </>
  );
}
