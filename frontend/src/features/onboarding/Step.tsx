import type { ReactNode } from 'react';
import { Button } from '@learnos/ui';

export interface StepProps {
  kicker: string;
  title: string;
  lede: string;
  /** What we do with the answer. Every step has one — asking without saying why
   *  is what made the first version feel like a form rather than a conversation. */
  because: ReactNode;
  children: ReactNode;
  onNext: () => void;
  onBack?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
}

export function Step({
  kicker,
  title,
  lede,
  because,
  children,
  onNext,
  onBack,
  nextLabel = 'Continue',
  nextDisabled,
}: StepProps) {
  return (
    <section className="step">
      <p className="step__kicker">{kicker}</p>
      <h1 className="step__title">{title}</h1>
      <p className="step__lede">{lede}</p>

      <div className="step__body">{children}</div>

      <p className="step__because">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <circle cx="8" cy="8" r="6.4" />
          <path d="M8 7.2v4M8 4.9v.1" strokeLinecap="round" />
        </svg>
        <span>{because}</span>
      </p>

      <div className="step__actions">
        <Button onClick={onNext} disabled={nextDisabled}>
          {nextLabel}
        </Button>
        {onBack ? (
          <Button variant="quiet" onClick={onBack}>
            Back
          </Button>
        ) : null}
      </div>
    </section>
  );
}

export function Stepper({ step, total }: { step: number; total: number }) {
  return (
    <div className="stepper">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`stepper__bar${i <= step ? ' stepper__bar--done' : ''}`}
          aria-hidden="true"
        />
      ))}
      <span className="stepper__label">
        Step {step + 1} of {total}
      </span>
    </div>
  );
}
