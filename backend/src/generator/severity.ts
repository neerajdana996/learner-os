/**
 * Which broken rules are worth losing a course over (T-164).
 *
 * A topic is about nineteen sequential model calls and the pipeline is
 * all-or-nothing: the transaction opens only once the last call has returned,
 * so any call that fails both its attempts throws the whole thing away. Per
 * topic, success is per-call reliability to the nineteenth power — at a 5%
 * per-call double-failure rate a topic completes 38% of the time.
 *
 * That arithmetic is only tolerable if the rules that can end a run are rules
 * worth ending it for, and until now they were not all the same kind:
 *
 * - **Integrity** — the output is unusable, or the measurement it feeds is
 *   invalid. A prereq cycle has no teaching order. An item that points at a
 *   listing it does not carry cannot be answered. An item whose options
 *   contain another item's answer has scored that item for free, three weeks
 *   before the learner sees it. These end the job, and should.
 *
 * - **Preference** — the course comes out slightly worse and entirely usable.
 *   Five items on one concept instead of six. One transfer item where the
 *   prompt asked for one or two and got none. A map with two independent
 *   starting points rather than three. None of these are worth nineteen calls
 *   and six minutes of a learner's wait.
 *
 * Both real failures on 2026-09-12 were preference rules.
 *
 * The distinction already existed in one place — `conceptMap.ts` throws below
 * `MIN_CONCEPTS` and only warns below `EXPECTED_MIN_CONCEPTS` — and this is
 * that idea applied to every rule.
 *
 * **Tolerated is not ignored.** A preference rule is still checked on every
 * attempt, still drives the repair retry, and is still reported as a warning
 * naming the rule and the concept, so content QA (T-045) is handed the list of
 * what to read by hand rather than finding it by accident.
 */
import { GenerationError, type GenerationErrorReason } from './errors.js';

/**
 * Listed explicitly, and the default is fatal: a reason added later is one
 * nobody has thought about yet, and the safe unthought-about answer is to stop
 * rather than to ship a course with a rule quietly bent.
 */
export const REPAIRABLE_REASONS: ReadonlySet<GenerationErrorReason> = new Set([
  // ---- concept map: shape preferences ----
  /** Fewer than three independent starting points. A flatter map is easier to
   *  recover from after a missed day; a narrower one still teaches. */
  'too_few_roots',
  /** A chain longer than five. Miss a day early and the tail is late, which is
   *  a worse course, not an impossible one. */
  'chain_too_deep',
  /** More than three prereqs on a concept — a sign it is not atomic. */
  'too_many_prereqs',
  /** Not two-to-four crux concepts, or a crux naming only one misconception.
   *  Crux drives which concepts are kept out of the held-out pool; a bad set
   *  makes a slightly worse control arm, not an invalid one. */
  'crux_count',
  'thin_crux',
  /** A capability with no concept behind it: the course promises something it
   *  never teaches. Worth a warning and a human look, not a dead topic. */
  'capability_unserved',

  // ---- items: per-concept preferences ----
  /** None, or more than two, of a concept's items marked transfer. Transfer is
   *  a measured outcome (plan.md §7), so a concept without one weakens that
   *  comparison by one concept — it does not corrupt it. */
  'transfer_count',
  /** Fewer than six items for a concept. Six is the review budget over seven
   *  days; five is a thinner rotation. */
  'too_few_items',
  /** More than two rich-format items on one concept: a time budget, not a
   *  correctness rule (T-083). */
  'too_many_rich',

  // ---- teaching ----
  /** Fewer than two corrections, or more than four. The map supplies one or
   *  two misconceptions and the validator asked for two to four, so this rule
   *  fired on any concept the map gave a single belief — it is a thinner
   *  lesson, not a broken one. */
  'corrections_count',
  /** The long explanation is no longer than the short one, so "read more"
   *  reveals the same text. A flat affordance, not an unteachable concept. */
  'explanation_not_expanded',

  // ---- the control arm (T-165) ----
  /** Fewer held-out concepts than `HELD_OUT_MIN`, because the prereq graph left
   *  too few eligible. A thin control arm is a weak result; refusing to build
   *  the course at all is no result. */
  'thin_control_arm',
  /**
   * A taught explanation names a held-out concept.
   *
   * A warning rather than fatal, deliberately, and it is the weaker of the two
   * halves of T-165 — the structural fix is `pickHeldOut` no longer choosing a
   * concept with taught dependants, which removes the reason a lesson would
   * reach for one. This is the backstop, and it matches model-written prose
   * against a title, so it is exactly the kind of rule that would one day fail
   * a nineteen-call generation over the words "time and space cost". Content QA
   * reads it; whether it should harden into an integrity rule is a call to make
   * once there is a run where it fires.
   */
  'held_out_leak',
  /** Decoration on one lesson or one question, not an unusable course — and
   *  the block is dropped rather than kept, so what is stored is what the
   *  prompts describe (T-166/T-167). */
  'block_without_domain',
]);

/**
 * `explain_rubric`, `missing_item_type`, `dangling_reference`,
 * `item_cues_another`, `batch_slug_mismatch`, `duplicate_prompt`, `cycle`,
 * `unknown_prereq`, `duplicate_slug`, `unknown_crux`, `unknown_capability`,
 * `too_few_concepts` and every shape/transport reason are deliberately absent.
 *
 * Two are worth spelling out because they look like preferences and are not:
 * `duplicate_prompt` means the learner meets the same question twice under two
 * concepts, which makes the second concept's score a copy of the first; and
 * `explain_rubric` over 200 characters exceeds what the row holds, so tolerating
 * it would only move the failure to the insert.
 */
export function isRepairable(error: unknown): error is GenerationError {
  return error instanceof GenerationError && REPAIRABLE_REASONS.has(error.reason);
}

export interface GenerationWarning {
  reason: GenerationErrorReason;
  /** The prompt that produced it — `items`, `teaching`, `conceptMap`. */
  prompt: string;
  message: string;
}

type WarningListener = (warning: GenerationWarning) => void;

let listener: WarningListener | null = null;

/**
 * Collects the rules bent while `run` executes. Deliberately the same shape as
 * `collectUsage`, and deliberately not async-local for the same reason: the
 * generation worker processes one job at a time, so two overlapping collectors
 * is a bug to fail on rather than interleave.
 */
export async function collectWarnings<T>(
  run: () => Promise<T>,
): Promise<{ result: T; warnings: GenerationWarning[] }> {
  if (listener) throw new Error('collectWarnings: already collecting — generations must not overlap');

  const warnings: GenerationWarning[] = [];
  listener = (warning) => warnings.push(warning);
  try {
    return { result: await run(), warnings };
  } finally {
    listener = null;
  }
}

export function recordWarning(warning: GenerationWarning): void {
  listener?.(warning);
  console.warn(`${warning.prompt}: tolerated ${warning.reason} — ${warning.message}`);
}

/**
 * The throw-or-warn decision at a rule site.
 *
 * Written as a factory rather than a flag check at each site so the two
 * outcomes cannot drift apart: every preference rule reports the same way, and
 * a rule that is not in `REPAIRABLE_REASONS` still throws even when the caller
 * asked to tolerate — a caller cannot opt out of integrity by passing a flag.
 *
 * `prompt` names the stage for the warning line, since the same reason can
 * come from more than one of them.
 */
export function failer(prompt: string, tolerate = false) {
  return (reason: GenerationErrorReason, message: string): void => {
    if (tolerate && REPAIRABLE_REASONS.has(reason)) {
      recordWarning({ reason, prompt, message });
      return;
    }
    throw new GenerationError(reason, message);
  };
}

/** What a validator accepts so a caller can ask it to tolerate preference
 *  rules. Absent or false is the strict behaviour every call had before. */
export interface ValidateOptions {
  tolerate?: boolean;
}
