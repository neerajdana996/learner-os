import type { PulseCreate } from '@learnos/shared';
import { upsertPulse } from './pulse.repository.js';

/**
 * The one-tap daily check-in (T-032).
 *
 * Asked once per **learner-local** day, after the first card they actually
 * answered — not after the first card shown, because a mood tap on a card
 * someone ignored is a question asked of an empty chair.
 *
 * There is no read side yet. This exists so that when the pilot's answer rate
 * dips in week two there is a column to put beside it, rather than a guess
 * about whether people were busy or the questions got harder.
 */
export async function recordPulse(userId: string, pulse: PulseCreate): Promise<{ ok: true }> {
  await upsertPulse(userId, pulse);
  return { ok: true };
}
