// SOURCE OF TRUTH for shared Zod schemas. Synced to frontend/src/shared and
// extension/src/shared by scripts/sync-shared.sh — never edit the copies.
//
// Browser-safe: only `zod` may be imported here. No `node:*`, drizzle, postgres,
// bullmq or ioredis (sync-shared.sh fails the build if it finds any).
import { z } from 'zod';

function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 86_400_000;
}

// ---------- Shared enums ----------
export const ConfidenceSchema = z.enum(['guess', 'think', 'sure']).nullable();
export const SurfaceSchema = z.enum(['web', 'extension', 'diagnostic', 'test']);
export const TeachModeSchema = z.enum(['try_first', 'example_first']);
export const ItemTypeSchema = z.enum(['recall', 'recognition', 'application', 'explain']);

// ---------- Route params ----------
/** `:id` path params. Rejects a malformed id with 400 before it reaches a
 *  uuid-typed column, where Postgres would raise a syntax error instead. */
export const IdParamSchema = z.object({ id: z.string().uuid() });

// ---------- Users ----------
export const UserCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

// ---------- Topics ----------
export const TopicCreateSchema = z
  .object({
    title: z.string().trim().min(2).max(120),
    why: z.string().trim().min(1).max(500).optional(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    dailyBudgetMin: z.number().int().min(5).max(30).default(15),
  })
  .refine((data) => !data.startsAt || !data.endsAt || daysBetween(data.startsAt, data.endsAt) >= 7, {
    message: 'endsAt must be at least 7 days after startsAt',
    path: ['endsAt'],
  });

// ---------- Items ----------
// Full payload as generated/stored server-side (includes the answer key).
// Never send this shape to a client directly — see PublicItemSchema.
const RecallPayloadSchema = z.object({
  type: z.literal('recall'),
  prompt: z.string().min(1),
  answer: z.string().min(1),
  accept: z.array(z.string()).optional(),
});

const RecognitionPayloadSchema = z.object({
  type: z.literal('recognition'),
  prompt: z.string().min(1),
  options: z.array(z.string()).length(4),
  answerIndex: z.number().int().min(0).max(3),
});

const ApplicationPayloadSchema = z.object({
  type: z.literal('application'),
  prompt: z.string().min(1),
  answer: z.string().min(1),
  accept: z.array(z.string()).optional(),
});

const ExplainPayloadSchema = z.object({
  type: z.literal('explain'),
  prompt: z.string().min(1),
  rubric: z.string().min(1),
});

export const ItemPayloadSchema = z.discriminatedUnion('type', [
  RecallPayloadSchema,
  RecognitionPayloadSchema,
  ApplicationPayloadSchema,
  ExplainPayloadSchema,
]);

// Client-facing view of an item: no answer/accept/answerIndex/rubric (plan.md §6,
// T-010). `options` is present only for recognition items.
export const PublicItemSchema = z.object({
  itemId: z.string().uuid(),
  conceptId: z.string().uuid(),
  type: ItemTypeSchema,
  prompt: z.string(),
  options: z.array(z.string()).length(4).optional(),
});

export const DueItemsResponseSchema = z.object({
  items: z.array(PublicItemSchema),
});

// ---------- Reviews / answers ----------
export const AnswerSchema = z.object({
  itemId: z.string().uuid(),
  response: z.union([z.string(), z.number().int()]).nullable().optional(),
  correct: z.boolean().nullable().optional(),
  confidence: ConfidenceSchema,
  latencyMs: z.number().int().nonnegative().optional(),
  surface: SurfaceSchema,
  idempotencyKey: z.string().uuid().optional(),
  snoozed: z.boolean().optional(),
  dismissed: z.boolean().optional(),
});

// ---------- Diagnostic ----------
export const DiagnosticStartSchema = z.object({}).strict();

export const DiagnosticAnswerSchema = z.object({
  conceptId: z.string().uuid(),
  itemId: z.string().uuid(),
  response: z.union([z.string(), z.number().int()]).nullable(),
  confidence: ConfidenceSchema,
  latencyMs: z.number().int().nonnegative(),
});

export const DiagnosticNextResponseSchema = z.discriminatedUnion('done', [
  z.object({
    done: z.literal(false),
    conceptId: z.string().uuid(),
    item: PublicItemSchema,
    progress: z.object({ asked: z.number().int().nonnegative(), max: z.number().int().positive() }),
  }),
  z.object({
    done: z.literal(true),
    summary: z.object({
      asked: z.number().int().nonnegative(),
      sureCount: z.number().int().nonnegative(),
      sureCorrectCount: z.number().int().nonnegative(),
    }),
  }),
]);

// ---------- Session ----------
const CorrectionSchema = z.object({ wrong: z.string(), why: z.string() });

const NewConceptSchema = z.object({
  conceptId: z.string().uuid(),
  title: z.string(),
  teachMode: TeachModeSchema,
  tryFirstPrompt: z.string().nullable(),
  explanationShort: z.string(),
  explanationLong: z.string(),
  corrections: z.array(CorrectionSchema),
  item: PublicItemSchema,
});

export const SessionResponseSchema = z.object({
  newConcepts: z.array(NewConceptSchema),
  dueReviews: z.array(PublicItemSchema),
  completedToday: z.boolean(),
});

// ---------- Tests (Day-30 / Day-45) ----------
export const TestStartSchema = z.object({
  kind: z.enum(['day30', 'day45']),
});

export const TestSubmitSchema = z.object({
  itemId: z.string().uuid(),
  response: z.union([z.string(), z.number().int()]).nullable(),
  confidence: ConfidenceSchema,
  latencyMs: z.number().int().nonnegative(),
});

// ---------- Daily pulse ----------
export const PulseCreateSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'day must be YYYY-MM-DD'),
  mood: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

// ---------- WebSocket protocol ----------
export const WsClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }),
]);

export const WsServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), serverTime: z.string() }),
  z.object({ type: z.literal('pong'), serverTime: z.string() }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);

// ---------- Health ----------
export const HealthResponseSchema = z.object({ ok: z.literal(true) });
