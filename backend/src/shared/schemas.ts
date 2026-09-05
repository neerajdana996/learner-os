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

/** `GET /due?limit=n`. Capped so one caller can't pull the whole queue. */
export const DueQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
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

/** plan.md §6 caps a session at three new concepts. */
export const MAX_NEW_CONCEPTS_PER_SESSION = 3;

// ---------- Session ----------
/** Body of POST /session/complete. Ids are checked against a freshly computed
 *  plan server-side, so this only has to be well-formed (T-016). */
export const SessionCompleteSchema = z.object({
  conceptIds: z.array(z.string().uuid()).max(MAX_NEW_CONCEPTS_PER_SESSION),
});

export const CorrectionSchema = z.object({ wrong: z.string(), why: z.string() });

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

// ---------- Map & score (T-017) ----------
export const ConceptStateSchema = z.enum(['known', 'taught', 'untaught', 'heldout']);

export const MapConceptSchema = z.object({
  conceptId: z.string().uuid(),
  /** Null for held-out concepts — a learner who sees the title studies it, and
   *  that destroys the control group the pilot rests on (plan.md §6). */
  title: z.string().nullable(),
  order: z.number().int(),
  state: ConceptStateSchema,
  mastery: z.number().min(0).max(1),
  atRisk: z.boolean(),
});

export const MapResponseSchema = z.object({
  topicId: z.string().uuid(),
  title: z.string(),
  /** Mean mastery over taught + known concepts, 0-100. */
  score: z.number().int().min(0).max(100),
  concepts: z.array(MapConceptSchema),
  /** `from` is the prerequisite, `to` the concept that depends on it. */
  edges: z.array(z.object({ from: z.string().uuid(), to: z.string().uuid() })),
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

// ---------- Users / profile (T-014) ----------
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const ActiveWindowSchema = z.object({
  start: z.string().regex(HHMM, 'start must be HH:MM'),
  end: z.string().regex(HHMM, 'end must be HH:MM'),
});

/**
 * When the extension is allowed to interrupt (T-028). Wall-clock local times in
 * the user's own timezone.
 *
 * A window never crosses midnight — 22:00–02:00 is entered as two windows — so
 * the extension can compare `start <= now < end` as plain strings with no
 * wraparound case. Zero-padded HH:MM sorts and compares lexicographically, which
 * is why the times are strings rather than minute counts.
 */
export const ActiveWindowsSchema = z
  .array(ActiveWindowSchema)
  .max(3, 'at most 3 active windows')
  .superRefine((windows, ctx) => {
    for (const [i, w] of windows.entries()) {
      if (w.start >= w.end) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [i, 'end'],
          message: 'end must be after start; a window may not cross midnight',
        });
      }
    }

    const sorted = [...windows].sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      // Adjacent is fine (09:00-12:00 then 12:00-15:00); strict overlap is not.
      if (prev && cur && cur.start < prev.end) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [i, 'start'],
          message: 'active windows must not overlap',
        });
      }
    }
  });

/** Uses the runtime's own tz database rather than shipping a list that rots.
 *  Available in browsers too, so this stays safe for the synced copy. */
export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const TimeZoneSchema = z.string().refine(isValidTimeZone, 'unknown IANA timezone');

export const UserUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).nullable(),
    timezone: TimeZoneSchema,
    activeWindows: ActiveWindowsSchema,
  })
  .partial();

export const UserProfileSchema = z.object({
  /** Extension cards per local day (T-028). */
  dailyCap: z.number().int().positive().default(12),
  /** Day-0 confidence minus accuracy, written by the diagnostic (T-015). */
  calibrationGap: z.number().nullable().default(null),
});

/** The shape the extension polls hourly (T-028) — everything `shouldShow()`
 *  needs in one request, so it never has to make a second. */
export const MeResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
  timezone: z.string().nullable(),
  activeWindows: ActiveWindowsSchema,
  profile: UserProfileSchema,
  hasExtensionToken: z.boolean(),
});

// ---------- Auth (T-013) ----------
export const MagicLinkSchema = z.object({
  // trim/lowercase run before the format check, not after: a pasted address
  // with a trailing space is the common case, and validating first would 400 it.
  email: z.string().trim().toLowerCase().email().max(320),
});

export const VerifyQuerySchema = z.object({ token: z.string().min(1).max(512) });

/**
 * Dev-only reset (T-079). `progress` keeps the generated course and throws away
 * what the learner did; `topics` deletes the course too and puts you back at
 * onboarding, which costs a real generation to undo.
 */
export const DevResetSchema = z.object({
  scope: z.enum(['progress', 'topics']),
});

/**
 * Dev-only password sign-in (T-070). The route that accepts this is not mounted
 * under `NODE_ENV=production` — it exists so a developer can reach the app
 * without a mail round trip, and it is the only place in the product where a
 * password appears at all.
 */
export const DevLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(1).max(200),
});

/** Deliberately says nothing about whether the address is registered — a
 *  different response for a known email would make this an account oracle. */
export const MagicLinkResponseSchema = z.object({ ok: z.literal(true) });

export const ExtensionTokenResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
});

// ---------- Health ----------
export const HealthResponseSchema = z.object({ ok: z.literal(true) });
