import {
  boolean,
  date,
  doublePrecision,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// Full topic lifecycle per sprint.md T-007/T-039: generating (job running) →
// active (Sprint 1-2 use) → testing (Day-30 test in progress) → holdout
// (Day 31-45, extension silenced) → done (Day-45 complete), or failed.
export const topicStatusEnum = pgEnum('topic_status', [
  'generating',
  'active',
  'testing',
  'holdout',
  'done',
  'failed',
]);
export const conceptTeachModeEnum = pgEnum('concept_teach_mode', ['try_first', 'example_first']);
export const itemTypeEnum = pgEnum('item_type', ['recall', 'recognition', 'application', 'explain']);
// Matches shared/schemas.ts SurfaceSchema — diagnostic (T-015) and test (T-038)
// reviews are recorded here too, just without card scheduling.
export const reviewSurfaceEnum = pgEnum('review_surface', ['web', 'extension', 'diagnostic', 'test']);
export const testKindEnum = pgEnum('test_kind', ['day0', 'day30', 'day45']);

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const topics = pgTable('topics', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  title: text('title').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  dailyBudgetMin: integer('daily_budget_min').default(15),
  status: topicStatusEnum('status').default('generating').notNull(),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const concepts = pgTable(
  'concepts',
  {
    id: serial('id').primaryKey(),
    topicId: integer('topic_id').notNull().references(() => topics.id),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    summary: text('summary'),
    order: integer('order').notNull(),
    heldOut: boolean('held_out').default(false).notNull(),
    teachMode: conceptTeachModeEnum('teach_mode'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    topicSlugUnique: uniqueIndex('concepts_topic_id_slug_unique').on(table.topicId, table.slug),
  }),
);

export const conceptPrereqs = pgTable(
  'concept_prereqs',
  {
    conceptId: integer('concept_id').notNull().references(() => concepts.id),
    prerequisiteConceptId: integer('prerequisite_concept_id').notNull().references(() => concepts.id),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.conceptId, table.prerequisiteConceptId] }),
  }),
);

export const items = pgTable('items', {
  id: serial('id').primaryKey(),
  conceptId: integer('concept_id').notNull().references(() => concepts.id),
  type: itemTypeEnum('type').notNull(),
  payload: jsonb('payload').notNull(),
  isTransfer: boolean('is_transfer').default(false).notNull(),
  flaggedBad: integer('flagged_bad').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const cards = pgTable(
  'cards',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id),
    conceptId: integer('concept_id').notNull().references(() => concepts.id),
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

export const reviewEvents = pgTable('review_events', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  conceptId: integer('concept_id').notNull().references(() => concepts.id),
  itemId: integer('item_id').references(() => items.id),
  cardId: integer('card_id').references(() => cards.id),
  correct: boolean('correct'),
  surface: reviewSurfaceEnum('surface').default('web').notNull(),
  predictedRecall: doublePrecision('predicted_recall').notNull(),
  gapDaysSinceLast: integer('gap_days_since_last').notNull(),
  idempotencyKey: text('idempotency_key').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const tests = pgTable('tests', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  kind: testKindEnum('kind').notNull(),
  scores: jsonb('scores').default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const dailyPulse = pgTable(
  'daily_pulse',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id),
    date: date('date', { mode: 'date' }).notNull(),
    mood: integer('mood'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // T-032: "POST /pulse {day, mood}, upsert" — one row per user per day.
    userDateUnique: uniqueIndex('daily_pulse_user_id_date_unique').on(table.userId, table.date),
  }),
);
