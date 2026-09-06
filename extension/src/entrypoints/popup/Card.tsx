import { useEffect, useRef, useState } from 'react';
import type { PublicItem } from '@learnos/shared';
import { Button, ConfidenceTap, QuestionCard } from '@learnos/ui';
import { postReview, type ReviewResult } from '../../lib/api';
import { getPopState, setPopState } from '../../lib/storage';
import { MIN_GAP_MS, recordAnswered, recordDismissed } from '../../lib/schedule';

/**
 * The twenty-second card (T-029).
 *
 * The question itself is the shared `QuestionCard` — the same component the
 * session player and the day-30 test use — so a `sequence` diagram or a code
 * listing renders here exactly as it does on the web, and a block added later
 * arrives on both surfaces at once. What this file adds is only the chrome that
 * is genuinely different: a card that interrupted you, and the two ways to make
 * it go away.
 *
 * There is deliberately **no navigation, no branding block and no score**. It
 * has one job and then it leaves. Anything that is not the question is a reason
 * to look away, and a card that gets dismissed costs the rest of the day's
 * retrieval — three in a row and the extension stops until tomorrow.
 */

/** Long enough to read the explanation, short enough that it closes itself. */
const CLOSE_AFTER_MS = 6000;
const SNOOZE_MS = 30 * 60 * 1000;

export interface CardProps {
  item: PublicItem;
  onClose: () => void;
}

export function Card({ item, onClose }: CardProps) {
  const [value, setValue] = useState<string | number | null>(null);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  /**
   * Generated once, when the card opens, not per attempt. The offline queue
   * (T-031) replays what it could not send, and a key minted per retry would
   * schedule the same card twice — which corrupts a measurement rather than
   * merely double-counting.
   */
  const idempotencyKey = useRef(crypto.randomUUID());
  const openedAt = useRef(Date.now());

  // Auto-close once the outcome has been read. Only after an answer: a card
  // still waiting for one must never disappear on its own, or it would count as
  // shown and never be answered.
  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(onClose, CLOSE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [result, onClose]);

  async function send(answer: Parameters<typeof postReview>[0]) {
    setSending(true);
    setFailed(false);
    try {
      return await postReview(answer);
    } catch {
      // T-031 owns the offline queue. Until then a failed send says so rather
      // than pretending: silently losing an answer is worse than asking again.
      setFailed(true);
      return null;
    } finally {
      setSending(false);
    }
  }

  async function submit() {
    if (value === null) return;
    const outcome = await send({
      itemId: item.itemId,
      response: value,
      confidence: null,
      latencyMs: Date.now() - openedAt.current,
      surface: 'extension',
      idempotencyKey: idempotencyKey.current,
    });
    if (!outcome) return;
    setResult(outcome);
    // An answer breaks a run of refusals, whether it was right or wrong.
    setPopState(recordAnswered(await getPopState()));
  }

  async function rate(confidence: 'guess' | 'think' | 'sure') {
    // Same idempotency key: this updates the event just recorded rather than
    // creating a second one. Asked *after* the answer, so it cannot become a
    // hint — and never pre-selected, because how often "certain" was right is
    // one of the numbers the pilot exists to measure.
    await send({
      itemId: item.itemId,
      response: value,
      confidence,
      latencyMs: Date.now() - openedAt.current,
      surface: 'extension',
      idempotencyKey: idempotencyKey.current,
    });
    onClose();
  }

  async function snooze() {
    await send({
      itemId: item.itemId,
      confidence: null,
      surface: 'extension',
      idempotencyKey: idempotencyKey.current,
      snoozed: true,
    });
    // Not a dismissal: someone asking for it later has not refused it, and
    // counting it as one would back the extension off for the whole day.
    //
    // `shouldShow` gates on `now - lastShownAt < MIN_GAP_MS`, so a snooze is
    // expressed by pushing the stamp *forward*: the 20-minute gap then expires
    // 30 minutes from now. Rewinding it would have made the next card sooner,
    // which is the opposite of what "later" means.
    const state = await getPopState();
    await setPopState({ ...state, lastShownAt: Date.now() + (SNOOZE_MS - MIN_GAP_MS) });
    onClose();
  }

  async function dismiss() {
    await send({
      itemId: item.itemId,
      confidence: null,
      surface: 'extension',
      idempotencyKey: idempotencyKey.current,
      dismissed: true,
    });
    const state = await getPopState();
    await setPopState(recordDismissed(state, new Date(), null));
    onClose();
  }

  return (
    <main className="card">
      <header className="card__bar">
        {/* The design shows the concept's name here. `PublicItem` carries only
            `conceptId` — the title is deliberately withheld from the client for
            held-out concepts (T-010) — so this stays generic until the due
            response carries a title it is safe to show. */}
        <span className="card__concept">Due now</span>
        <button type="button" className="card__x" onClick={() => void dismiss()} aria-label="Dismiss">
          ✕
        </button>
      </header>

      <div className="card__body">
        <QuestionCard item={item} value={value} onChange={setValue} />

        {result ? (
          <div className="card__result" aria-live="polite">
            <p className={result.correct ? 'card__verdict card__verdict--right' : 'card__verdict'}>
              {result.correct ? 'Right' : 'Not this time'}
              {/* The gap is the product. A right answer after nine days is the
                  thing being measured; the same answer after ten minutes is not. */}
              {result.gapDaysSinceLast !== null && result.gapDaysSinceLast >= 1
                ? ` — ${result.gapDaysSinceLast} day${result.gapDaysSinceLast === 1 ? '' : 's'} since you last saw this`
                : null}
            </p>
            {result.feedback ? <p className="card__why">{result.feedback}</p> : null}

            <ConfidenceTap value={null} onChange={(c) => void rate(c)} />
          </div>
        ) : (
          <div className="card__actions">
            <Button type="button" onClick={() => void submit()} disabled={value === null || sending}>
              {sending ? 'Checking…' : 'Answer'}
            </Button>
            <Button type="button" variant="quiet" onClick={() => void snooze()} disabled={sending}>
              Later
            </Button>
          </div>
        )}

        {failed ? (
          <p className="card__error" role="alert">
            Could not reach the server. Your answer was not saved — try again.
          </p>
        ) : null}
      </div>
    </main>
  );
}
