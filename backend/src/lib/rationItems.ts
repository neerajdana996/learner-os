/**
 * Which item each new concept is taught with (T-088's rationing).
 *
 * A `codeEditor` costs two to four minutes against a daily budget of ten to
 * fifteen, so a session that hands out three of them is a session nobody
 * finishes — and an abandoned session teaches nothing and schedules nothing.
 * One per session, and only when a concept is newly taught.
 *
 * Pure, and separate from the planner, because "how many concepts" and "which
 * item for each" are different questions: `planSession` decides the first from
 * the budget, this decides the second from what the generator produced.
 */

export const MAX_EDITORS_PER_SESSION = 1;

export interface RationableItem {
  id: string;
  conceptId: string;
  /** `items.answer_kind`, null for a plain prompt. */
  answerKind: string | null;
}

const EXPENSIVE = 'codeEditor';

/**
 * One item per concept, in the order the concepts are taught.
 *
 * Concepts are processed in the order given, so the ration goes to the first
 * concept that has an editor rather than to whichever row the database
 * happened to return last — which is what decided it before.
 *
 * A concept whose *only* items are editors still gets one, even past the
 * ration. Every generated concept has six to eight items with at most two rich
 * (T-083), so this should not happen; if it does, a lesson with a question is
 * better than a lesson with none, and the cap is the thing worth bending.
 */
export function rationItems<T extends RationableItem>(
  conceptIds: string[],
  rows: T[],
  max = MAX_EDITORS_PER_SESSION,
): Map<string, T> {
  // Generic over the row so the caller keeps its own fields — this function has
  // no business knowing an item has a payload.
  const byConcept = new Map<string, T[]>();
  for (const row of rows) {
    const list = byConcept.get(row.conceptId);
    if (list) list.push(row);
    else byConcept.set(row.conceptId, [row]);
  }

  const chosen = new Map<string, T>();
  let editors = 0;

  for (const conceptId of conceptIds) {
    const candidates = byConcept.get(conceptId);
    if (!candidates || candidates.length === 0) continue;

    const cheap = candidates.find((c) => c.answerKind !== EXPENSIVE);
    const editor = candidates.find((c) => c.answerKind === EXPENSIVE);

    let pick: T | undefined;
    if (editor && editors < max) {
      pick = editor;
      editors += 1;
    } else {
      pick = cheap ?? candidates[0];
      if (pick?.answerKind === EXPENSIVE) editors += 1;
    }

    if (pick) chosen.set(conceptId, pick);
  }

  return chosen;
}
