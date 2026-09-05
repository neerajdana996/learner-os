export type Role = 'product' | 'backend' | 'student' | 'other';

export interface PilotTopic {
  title: string;
  blurb: string;
  /** Why this one suits a given role. Shown on the recommended card. */
  fit: Partial<Record<Role, string>>;
}

/**
 * The three topics this pilot runs.
 *
 * All three are things engineers *admit* to forgetting and re-learning, so the
 * pilot's question ("did it stick?") is one the learner already cares about.
 * Each has clean prerequisite structure for the DAG and obvious transfer items:
 * apply the idea to a case you have not seen.
 *
 * Three, not ten. The headline measurement is within-subject — taught versus
 * held-out concepts for the *same* learner — so deltas pool across everyone
 * regardless of topic, and three is no threat to it. The limit is elsewhere:
 * every question is read by hand before anyone sees it (~1h per topic,
 * T-024/T-045), and with only one person on a topic you cannot separate "the
 * teaching failed" from "that topic generated badly". Generated per-learner
 * topics are T-058.
 */
export const PILOT_TOPICS: PilotTopic[] = [
  {
    title: 'Sliding window',
    blurb:
      'The pattern behind most "longest substring / smallest subarray" problems — when a window can grow, when it must shrink, and what invariant you are holding.',
    fit: {
      student: 'One pattern that unlocks a whole family of problems — a good first thirty days.',
      product: 'Compact, high-frequency, and the one people re-derive from scratch every time.',
    },
  },
  {
    title: 'Dynamic programming',
    blurb:
      'Memoisation, tabulation, and the part everyone actually gets stuck on: choosing the state. From overlapping subproblems through to space-optimised rolling arrays.',
    fit: {
      product: 'The classic "I understood it in the video and forgot it by Friday" topic.',
      student: 'Broad and cumulative, so spacing has the most to prove here.',
      other: 'The most commonly re-learned topic in the set.',
    },
  },
  {
    title: 'Consistency in distributed systems',
    blurb:
      'CAP and what it actually constrains, then the part that matters in practice: partitions, quorums, linearizability versus eventual consistency, and why PACELC exists.',
    fit: {
      backend: 'Everyone can recite CAP. Far fewer can say what it rules out on a Tuesday afternoon.',
      other: 'Widely half-remembered, and the misconceptions are unusually specific.',
    },
  },
];

const RECOMMENDED_BY_ROLE: Record<Role, string> = {
  product: 'Dynamic programming',
  backend: 'Consistency in distributed systems',
  student: 'Sliding window',
  other: 'Dynamic programming',
};

/**
 * A steer, not a gate — both topics stay selectable.
 *
 * Deliberately a lookup rather than a model call: with three options and four
 * roles there is nothing for a model to work out, and a recommendation that
 * takes two seconds and can fail is worse than one that is instant and can't.
 * When the topic list is generated per learner (T-058) this becomes the place a
 * real recommendation lands.
 */
export function recommendTopic(role: Role | null): PilotTopic | null {
  if (!role) return null;
  return PILOT_TOPICS.find((topic) => topic.title === RECOMMENDED_BY_ROLE[role]) ?? null;
}
