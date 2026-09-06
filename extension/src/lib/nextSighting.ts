/**
 * "You'll see this one again…" — when, truthfully.
 *
 * The design canvas writes this line as "You'll see this one again tomorrow."
 * FSRS does not promise tomorrow: a lapsed card usually comes back inside the
 * same day on a learning step, and a mature one can be days out. The reassuring
 * half of that sentence is "again", not "tomorrow", so the day is read from the
 * schedule the server just computed rather than asserted.
 *
 * A card that is not scheduled at all (a snooze, a dismissal, an ungraded
 * answer) returns null and the line is not shown — there is nothing to promise.
 */
export function nextSighting(due: string | null, now: Date): string | null {
  if (!due) return null;
  const at = new Date(due);
  if (Number.isNaN(at.getTime())) return null;

  // Calendar days apart, not elapsed hours: "tomorrow" is a date, and a card
  // due in 20 hours can land either side of midnight.
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(at) - startOfDay(now)) / 86_400_000);

  if (days <= 0) return 'You’ll see this one again later today.';
  if (days === 1) return 'You’ll see this one again tomorrow.';
  return `You’ll see this one again in ${days} days.`;
}
