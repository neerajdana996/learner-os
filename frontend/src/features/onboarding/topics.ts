export type Role = 'developer' | 'student' | 'designer' | 'other';

export interface PilotTopic {
  title: string;
  blurb: string;
  /** Why this one suits a given role. Shown on the recommended card. */
  fit: Partial<Record<Role, string>>;
}

/**
 * The two topics this pilot runs, five people each (sprint.md).
 *
 * Both are algorithmic patterns on purpose: forgetting them is the *admitted*
 * problem — people re-grind the same material before every interview — so the
 * pilot's question ("did it stick?") is one the learner already cares about.
 * They also carry clean prerequisite structure for the DAG and obvious transfer
 * items: apply the pattern to a problem you have not seen.
 *
 * Two, not ten, because every question in both is read by hand before anyone
 * sees it (T-024/T-045) and because five people per topic is what makes the
 * day-30 comparison mean anything. Generated per-learner topics are Sprint 5.
 */
export const PILOT_TOPICS: PilotTopic[] = [
  {
    title: 'Sliding window',
    blurb:
      'The pattern behind most "longest substring / smallest subarray" problems — when a window can grow, when it must shrink, and what invariant you are holding.',
    fit: {
      developer: 'Compact, high-frequency, and the one people re-derive from scratch every time.',
      student: 'A single pattern that unlocks a whole family of problems.',
    },
  },
  {
    title: 'Dynamic programming',
    blurb:
      'Memoisation, tabulation, and the part everyone actually gets stuck on: choosing the state. From overlapping subproblems through to space-optimised rolling arrays.',
    fit: {
      developer: 'The classic "I understood it in the video and forgot it by Friday" topic.',
      student: 'Broad and cumulative, so spacing has the most to prove here.',
      other: 'The most commonly re-learned topic in the set.',
    },
  },
];

const RECOMMENDED_BY_ROLE: Record<Role, string> = {
  developer: 'Dynamic programming',
  student: 'Dynamic programming',
  designer: 'Sliding window',
  other: 'Sliding window',
};

/**
 * A steer, not a gate — both topics stay selectable.
 *
 * Deliberately a lookup rather than a model call: with two options and four
 * roles there is nothing for a model to work out, and a recommendation that
 * takes two seconds and can fail is worse than one that is instant and can't.
 * When the topic list is generated per learner (Sprint 5) this becomes the
 * place a real recommendation lands.
 */
export function recommendTopic(role: Role | null): PilotTopic | null {
  if (!role) return null;
  return PILOT_TOPICS.find((topic) => topic.title === RECOMMENDED_BY_ROLE[role]) ?? null;
}
