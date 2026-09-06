/**
 * A retired item — one the founder rejected during content QA (T-024) — must
 * never be served again.
 *
 * Retirement rides on `items.flagged_bad` rather than a new column, because
 * sprint.md's backlog already plans an auto-retire at `flagged_bad >= 3` from
 * learner reports; one threshold means a manually retired item and an
 * auto-retired one are excluded by exactly the same rule.
 */
export const RETIRED_FLAG_THRESHOLD = 3;
