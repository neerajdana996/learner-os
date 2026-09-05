/**
 * Which model does which job, and how hard it is allowed to think.
 *
 * The lineup is all reasoning models with the same 1.05M context, so the choice
 * is about cost and latency rather than capability ceilings:
 *
 *   gpt-6-astra    $10 / $50   complex reasoning, end-to-end work
 *   gpt-5.6-sol    $4  / $20   complex professional work
 *   gpt-5.6-terra  $2  / $12   balancing intelligence and cost
 *   gpt-5.6-luna   $0.20/$1.20 cost-sensitive, high volume
 *
 * **`reasoning_effort` must be set explicitly.** gpt-5.6 defaults to `medium`
 * when the field is omitted, so leaving it off silently buys reasoning latency
 * and tokens on every call — including one-line grading judgements where it is
 * pure waste.
 *
 * Cheap models are safe on the constrained prompts because bad output cannot
 * reach a learner: every response is schema-validated and then domain-checked
 * (acyclic graph, no duplicate slugs, all four item types, explanations that
 * actually differ), and a failure retries once before failing the job loudly.
 */
export const MODELS = {
  /** Once per topic, and the foundation the whole 30 days is built on. A better
   *  map is also fewer corrections during content QA, which T-045 measures. */
  conceptMap: { model: 'gpt-5.6-sol', reasoningEffort: 'medium' },
  /** Prose the learner actually reads, ~25 calls per topic. */
  teaching: { model: 'gpt-5.6-terra', reasoningEffort: 'low' },
  /** Tightly constrained and fully validated, so the cheap tier carries it.
   *  A little reasoning still helps it vary six to eight questions properly. */
  items: { model: 'gpt-5.6-luna', reasoningEffort: 'low' },
  /** In the request path — a learner is waiting on this one. Latency wins. */
  gradeExplanation: { model: 'gpt-5.6-luna', reasoningEffort: 'none' },
} as const satisfies Record<string, { model: string; reasoningEffort: ReasoningEffort }>;

/** What the gpt-5.6 family actually accepts. `minimal` and `max` appear in the
 *  general docs but are rejected by these models with a 400 — verified. */
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';

/** Used by any prompt without an entry above. */
export const DEFAULT_MODEL = 'gpt-5.6-terra';
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'low';
