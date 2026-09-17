/**
 * When a concept stops being a memory problem and starts being a content
 * problem (T-059).
 *
 * Anki tags a card a leech after **8** lapses and suspends it, on the reasoning
 * that a card you keep forgetting is usually ambiguous or holds two ideas at
 * once. The mechanism carries over; the number does not. Anki counts over
 * months, while a Cold Recall topic teaches for seven days and a concept comes
 * up a handful of times in that week — a threshold of 8 could not be reached
 * before the teaching ends, so it would never fire.
 *
 * **Four** is "you have failed this four times in one week", which is already
 * most of what a ten-minute day can spare on one concept. It is deliberately
 * one constant: if the dry run (T-044) shows concepts being set aside that the
 * learner was about to get, this is the line to change.
 */
export const LEECH_LAPSES = 4;

/** FSRS counts a lapse when a review-state card is failed, so this is failures
 *  after the concept was learned, never the stumbles on the way there. */
export function isLeech(lapses: number): boolean {
  return lapses >= LEECH_LAPSES;
}
