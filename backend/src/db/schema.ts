import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// UUID primary keys, not serial: ids cross a trust boundary (they appear in URLs,
// in the extension's offline queue, and in client-generated payloads), and the
// shared API contract in src/shared/schemas.ts types them as `z.string().uuid()`.
// Sequential integers would also let one user enumerate another's item ids.

// Full topic lifecycle per sprint.md T-007/T-039: generating (job running) →
// active (the seven teaching days) → holdout (days 8-29, extension silenced —
// this gap is the measurement) → testing (Day-30 test in progress) → done, or
// failed. Rewritten 2026-09-07: the old comment described a Day-45 second test
// that plan.md dropped on 2026-09-06.
export const topicStatusEnum = pgEnum('topic_status', [
  'generating',
  'active',
  'testing',
  'holdout',
  'done',
  'failed',
]);
export const conceptTeachModeEnum = pgEnum('concept_teach_mode', ['try_first', 'example_first']);
// What KIND of thing a concept is, decided once during the concept-map pass
// (T-082). It selects the prompt fragment the item generator appends and the
// blocks it is allowed to emit — a code concept can be asked with a blank cut
// into real source, a prose one cannot. Per concept and not per topic: "Big-O
// of a hash lookup" and "write a hash function" live in one topic and want
// different formats.
export const conceptDomainEnum = pgEnum('concept_domain', ['code', 'math', 'systems', 'prose']);
export const itemTypeEnum = pgEnum('item_type', ['recall', 'recognition', 'application', 'explain']);
// Matches shared/schemas.ts SurfaceSchema — diagnostic (T-015) and test (T-038)
// reviews are recorded here too, just without card scheduling.
export const reviewSurfaceEnum = pgEnum('review_surface', ['web', 'extension', 'diagnostic', 'test']);
// Matches shared/schemas.ts ConfidenceSchema. Nullable on the column: a snoozed
// or dismissed card is recorded without the user ever rating their confidence.
export const confidenceEnum = pgEnum('confidence', ['guess', 'think', 'sure']);
// `day45` is retained in the enum but **nothing writes it**: plan.md's
// 2026-09-06 decision dropped that test, since day 30 already sits twenty-three
// days after the last review. Removing an enum value needs a migration and buys
// nothing; the guarantee lives in there being no code path that creates one.
export const testKindEnum = pgEnum('test_kind', ['day0', 'day30', 'day45']);
// One sessions table serves both surfaces: the web cookie and the extension's
// bearer token (T-013). `kind` is what T-034's "connected" state keys on.
export const sessionKindEnum = pgEnum('session_kind', ['web', 'extension']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name'),
  // IANA zone, nullable until onboarding sets it (T-014). Every "today" in the
  // product is the learner's today, not the server's (T-023).
  timezone: text('timezone'),
  // Array of { start: 'HH:MM', end: 'HH:MM' } wall-clock local times, max 3,
  // non-overlapping, never crossing midnight (T-014). The extension reads these
  // via GET /me to decide when it may pop a card (T-028).
  activeWindows: jsonb('active_windows').default([]).notNull(),
  // Loose bag for per-user tuning that isn't worth a column each:
  // `dailyCap` (extension cards/day, default 12 — T-028) and `calibrationGap`
  // (day-0 confidence minus accuracy, written by the diagnostic — T-015).
  profile: jsonb('profile').default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const topics = pgTable('topics', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  title: text('title').notNull(),
  // Why the learner wants this topic — collected at onboarding (plan.md §4,
  // T-018) and accepted by TopicCreateSchema, so it needs somewhere to land.
  why: text('why'),
  // The language every listing and example in this topic is written in (T-091).
  // Nullable with NO default, because three states have to stay
  // distinguishable: the learner named one, the learner said it doesn't matter,
  // and the topic predates the question. The last two are both null today; the
  // topic profile (T-092) fills a null in and records that it inferred it.
  language: text('language'),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  dailyBudgetMin: integer('daily_budget_min').default(15),
  status: topicStatusEnum('status').default('generating').notNull(),
  error: text('error'),
  // The adaptive diagnostic's walk state between requests (T-015):
  // { estimates: Record<conceptId, number>, asked: conceptId[] }. Null until
  // the diagnostic starts, and left in place afterwards as the day-0 record.
  diagnosticState: jsonb('diagnostic_state'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const concepts = pgTable(
  'concepts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    topicId: uuid('topic_id').notNull().references(() => topics.id),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    summary: text('summary'),
    order: integer('order').notNull(),
    heldOut: boolean('held_out').default(false).notNull(),
    teachMode: conceptTeachModeEnum('teach_mode'),
    // Nullable with NO default on purpose (T-079). An existing concept's domain
    // is genuinely unknown, and defaulting to 'prose' would silently claim
    // otherwise for every concept generated before T-082 shipped.
    domain: conceptDomainEnum('domain'),
    // Teaching content (T-053), rendered by the session screen (T-021).
    // Nullable because held-out concepts are never taught and never get any.
    // `tryFirstPrompt` is the productive-failure question (plan.md §3.5);
    // `corrections` is [{ wrong, why }] for the misconceptions learners bring.
    tryFirstPrompt: text('try_first_prompt'),
    explanationShort: text('explanation_short'),
    explanationLong: text('explanation_long'),
    corrections: jsonb('corrections').default([]).notNull(),
    // A code sample or a diagram to attach to `tryFirstPrompt`, for a concept
    // whose correct answer is a listing or a topology rather than a sentence
    // (T-145 — the teaching-side mirror of T-083/T-108's item blocks). Null
    // for every concept generated before this shipped, and for any concept
    // whose domain fragment declined to write one — `TeachBlockSchema`
    // (@learnos/shared) is the shape; nothing here validates it further, the
    // same trust boundary `corrections` above already crosses.
    teachBlock: jsonb('teach_block'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    topicSlugUnique: uniqueIndex('concepts_topic_id_slug_unique').on(table.topicId, table.slug),
  }),
);

export const conceptPrereqs = pgTable(
  'concept_prereqs',
  {
    conceptId: uuid('concept_id').notNull().references(() => concepts.id),
    prerequisiteConceptId: uuid('prerequisite_concept_id').notNull().references(() => concepts.id),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.conceptId, table.prerequisiteConceptId] }),
  }),
);

// `payload` holds the whole discriminated ItemPayloadSchema, including the
// optional `blocks` array (T-080) — so rich formats need no column of their own.
// `answerKind` is the one thing denormalised out of it, for the one query that
// cannot read JSON: see below.
export const items = pgTable(
  'items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conceptId: uuid('concept_id').notNull().references(() => concepts.id),
    type: itemTypeEnum('type').notNull(),
    payload: jsonb('payload').notNull(),
    // The `kind` of this item's answer block, or NULL for a plain prompt — which
    // is every item generated before T-080. It exists because the extension's
    // due-item pick has to exclude formats that cannot render in a 380x300 popup
    // (`codeEditor`, `orderLines`, T-089), and filtering on `payload->'blocks'`
    // is neither indexable nor readable at the repository layer.
    //
    // `text` and not a pgEnum deliberately: block kinds will churn while the
    // remaining categories land, and an enum makes every addition a migration
    // for a column nothing joins on.
    answerKind: text('answer_kind'),
    isTransfer: boolean('is_transfer').default(false).notNull(),
    flaggedBad: integer('flagged_bad').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    answerKindIdx: index('items_answer_kind_idx').on(table.answerKind),
  }),
);

export const cards = pgTable(
  'cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id),
    conceptId: uuid('concept_id').notNull().references(() => concepts.id),
    due: timestamp('due', { withTimezone: true }).notNull(),
    stability: doublePrecision('stability').default(0).notNull(),
    difficulty: doublePrecision('difficulty').default(0).notNull(),
    elapsedDays: integer('elapsed_days').default(0).notNull(),
    scheduledDays: integer('scheduled_days').default(0).notNull(),
    reps: integer('reps').default(0).notNull(),
    lapses: integer('lapses').default(0).notNull(),
    state: integer('state').default(0).notNull(),
    lastReview: timestamp('last_review', { withTimezone: true }),
    taughtAt: timestamp('taught_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userConceptUnique: uniqueIndex('cards_user_id_concept_id_unique').on(table.userId, table.conceptId),
  }),
);

export const reviewEvents = pgTable(
  'review_events',
  {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  conceptId: uuid('concept_id').notNull().references(() => concepts.id),
  itemId: uuid('item_id').references(() => items.id),
  cardId: uuid('card_id').references(() => cards.id),
  correct: boolean('correct'),
  // Confidence/latency feed the calibration metrics (T-038, T-040); snoozed and
  // dismissed distinguish "didn't answer" from "answered wrong" (T-009, T-030).
  confidence: confidenceEnum('confidence'),
  latencyMs: integer('latency_ms'),
  snoozed: boolean('snoozed').default(false).notNull(),
  dismissed: boolean('dismissed').default(false).notNull(),
  // True when the learner took the skeleton hint on a `codeEditor` item (T-088).
  // Without it a hinted pass and a cold pass are the same row, and the Day-30
  // retention gain — the one number the pilot exists to produce — quietly
  // inflates. The scheduler treats an assisted pass as a lapse regardless of
  // whether the cases went green.
  assisted: boolean('assisted').default(false).notNull(),
  surface: reviewSurfaceEnum('surface').default('web').notNull(),
  predictedRecall: doublePrecision('predicted_recall').notNull(),
  // Nullable on purpose: on a concept's first review there is no previous review
  // to measure from, and NULL must stay distinguishable from a real 0-day gap
  // (T-009 asserts null here; T-040 bins scheduler calibration on gap >= 1).
  gapDaysSinceLast: integer('gap_days_since_last'),
  idempotencyKey: text('idempotency_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // Per user, not global (T-009: "unique per user"). A global unique would let
    // one user's key collide with another's and reject the second user's answer
    // outright. Postgres treats NULLs as distinct, so un-keyed events are fine.
    userIdempotencyUnique: uniqueIndex('review_events_user_id_idempotency_key_unique').on(
      table.userId,
      table.idempotencyKey,
    ),
  }),
);

export const tests = pgTable('tests', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  // A test is scoped to one topic: the route is POST /topics/:id/tests (T-038)
  // and the Day-30/45 lifecycle is per topic (T-039).
  topicId: uuid('topic_id').notNull().references(() => topics.id),
  kind: testKindEnum('kind').notNull(),
  // The item set chosen when the test was built, so GET /tests/:id/next can
  // resume it across requests (T-038).
  itemIds: jsonb('item_ids').default([]).notNull(),
  scores: jsonb('scores').default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const dailyPulse = pgTable(
  'daily_pulse',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id),
    date: date('date', { mode: 'date' }).notNull(),
    mood: integer('mood'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // T-032: "POST /pulse {day, mood}, upsert" — one row per user per day.
    userDateUnique: uniqueIndex('daily_pulse_user_id_date_unique').on(table.userId, table.date),
  }),
);

/**
 * What the client says about itself (T-035).
 *
 * The server knows what it *served*; only the client knows what was actually
 * put in front of someone and what happened to it. Without `card_shown` the
 * answer rate has no denominator, and without `card_closed_no_action` the
 * biggest category of non-answer is invisible — Chrome closes an extension
 * popup the instant it loses focus, silently.
 *
 * `event` is text, not a pgEnum, on purpose: telemetry is the thing that grows,
 * and a new event name should not need a migration. `ClientEventNameSchema`
 * validates it at the route, so nothing unrecognised is written — the integrity
 * lives at the boundary rather than in the column type.
 *
 * **`meta` must never carry an answer.** It is for an item id, an error string,
 * a surface. This table is not access-controlled the way `review_events` is
 * and is meant to be cheap to read in bulk.
 */
export const clientEvents = pgTable(
  'client_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    event: text('event').notNull(),
    meta: jsonb('meta'),
    /** When it happened on the device — the worker batches on a five-minute
     *  alarm, so this is not the time the row was written. */
    at: timestamp('at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // Every query this table exists for is "how many of X did this user
    // produce, over a window".
    userEventIdx: index('client_events_user_id_event_idx').on(table.userId, table.event, table.at),
  }),
);

// Magic-link tokens (T-013). Stored as a SHA-256 hash, never the raw value a
// learner receives — a leaked dump otherwise hands over live login links.
export const authTokens = pgTable('auth_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  // Single use is enforced by setting this, not by deleting the row: a replayed
  // link must stay distinguishable from an unknown one, both for the 401 path
  // and for working out what happened afterwards.
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const oauthProviderEnum = pgEnum('oauth_provider', ['google', 'github']);

/**
 * A provider identity (T-055), kept separate from `users` so one human can hold
 * several: Google, GitHub and a magic link all land on the same `users` row.
 *
 * Identity is `(provider, provider_user_id)` — the provider's immutable subject
 * id — never the email. An email can be changed at the provider; the subject id
 * cannot, so keying on email would let an address change silently re-point an
 * account.
 */
export const oauthAccounts = pgTable(
  'oauth_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id),
    provider: oauthProviderEnum('provider').notNull(),
    providerUserId: text('provider_user_id').notNull(),
    email: text('email'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    providerIdentityUnique: uniqueIndex('oauth_accounts_provider_provider_user_id_unique').on(
      table.provider,
      table.providerUserId,
    ),
    // One account per provider per user: a second Google login for someone who
    // already linked Google is the same identity, not a new link.
    userProviderUnique: uniqueIndex('oauth_accounts_user_id_provider_unique').on(
      table.userId,
      table.provider,
    ),
  }),
);

// Web cookie sessions and extension bearer tokens (T-013), hashed like above.
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  token: text('token').notNull().unique(),
  kind: sessionKindEnum('kind').default('web').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// One row per completed daily session (T-023). `day` is a calendar date in the
// learner's timezone, so the unique index makes "completing twice today is a
// no-op" a database guarantee rather than route logic.
export const sessionDays = pgTable(
  'session_days',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id),
    topicId: uuid('topic_id').notNull().references(() => topics.id),
    day: date('day', { mode: 'string' }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userTopicDayUnique: uniqueIndex('session_days_user_id_topic_id_day_unique').on(
      table.userId,
      table.topicId,
      table.day,
    ),
  }),
);
