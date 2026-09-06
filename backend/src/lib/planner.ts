/**
 * How much to put in front of a learner today (T-016).
 *
 * Pure — no DB, no clock. The sizing rules are the part most likely to be
 * subtly wrong, and keeping them here makes every case a unit test with no
 * fixtures, the same shape as `heldOut.ts`, `diagnostic.ts` and `today.ts`.
 */

/** plan.md §6: cognitive-load management. Three new ideas is the ceiling
 *  regardless of how far behind the schedule has fallen. */
export const MAX_NEW_CONCEPTS = 3;
/** Rough costs used only for fitting a session into the daily budget. */
export const SECONDS_PER_REVIEW = 45;
export const SECONDS_PER_NEW_CONCEPT = 180;

export interface PlanInput {
  /** Untaught, non-held-out concepts whose prerequisites are already met. */
  readyCount: number;
  dueCount: number;
  /** Whole days left until the topic's `endsAt`. */
  remainingDays: number;
  budgetMin: number;
}

export interface Plan {
  newConceptCount: number;
  reviewCount: number;
}

export function planSession({ readyCount, dueCount, remainingDays, budgetMin }: PlanInput): Plan {
  // Pace to finish the map by endsAt (plan.md §6). Past the end date, or on the
  // last day, there is no meaningful division left to do — fall back to the cap
  // rather than dividing by zero or a negative.
  const pace = remainingDays > 0 ? Math.ceil(readyCount / remainingDays) : MAX_NEW_CONCEPTS;
  const wanted = Math.min(pace, MAX_NEW_CONCEPTS, readyCount);

  const budgetSec = Math.max(0, budgetMin) * 60;

  // New concepts are allocated first: teaching is the thing with a deadline,
  // while a review that doesn't fit today simply comes back tomorrow.
  let newConceptCount = Math.min(wanted, Math.floor(budgetSec / SECONDS_PER_NEW_CONCEPT));
  let reviewCount = Math.min(
    dueCount,
    Math.floor(Math.max(0, budgetSec - newConceptCount * SECONDS_PER_NEW_CONCEPT) / SECONDS_PER_REVIEW),
  );

  // A budget too small for anything would hand back an empty session while work
  // is waiting, which reads as "you're done" and quietly stalls the course.
  // Offer one thing instead, preferring a review as the cheaper of the two.
  if (newConceptCount === 0 && reviewCount === 0) {
    if (dueCount > 0) reviewCount = 1;
    else if (wanted > 0) newConceptCount = 1;
  }

  return { newConceptCount, reviewCount };
}

/** Whole days from `now` until `endsAt`, floored at 0. Null endsAt (the bare
 *  Sprint 1 demo topic) has no deadline to pace against. */
export function remainingDays(endsAt: Date | null, now: Date): number {
  if (!endsAt) return 0;
  return Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / 86_400_000));
}
