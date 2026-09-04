// SOURCE OF TRUTH for the Postgres schema (plan.md §5). Only edited in schema tasks.
//
// T-001 leaves this empty so `drizzle-kit push` has a valid (no-op) target and
// docker compose can boot. Tables (users, topics, concepts, concept_prereqs,
// items, cards, review_events, tests, daily_pulse) are added in T-049.
export {};
