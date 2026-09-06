// SOURCE OF TRUTH for shared Zod schemas — the API contract all three apps
// agree on. There is one copy now: this file, published as `@learnos/shared`.
//
// Browser-safe: only `zod` may be imported here. No `node:*`, drizzle, postgres,
// bullmq or ioredis — this package is compiled by Vite for the web app and by
// WXT for the extension, and neither has Node. Each client keeps a smoke test
// (`src/shared.test.ts`) that fails if something Node-only ever leaks in.
import { z } from 'zod';
import { BlockSchema, BlockGenerationSchema, PublicBlockSchema, optionalOrNull } from './blocks.js';

function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 86_400_000;
}

// ---------- Shared enums ----------
export const ConfidenceSchema = z.enum(['guess', 'think', 'sure']).nullable();
export const SurfaceSchema = z.enum(['web', 'extension', 'diagnostic', 'test']);
export const TeachModeSchema = z.enum(['try_first', 'example_first']);
export const ItemTypeSchema = z.enum(['recall', 'recognition', 'application', 'explain']);
/**
 * What a *correct answer* to a concept looks like — not what subject it belongs
 * to (T-082). Source code → `code`; a number or an expression → `math`; a
 * topology or an ordering of events → `systems`; a sentence → `prose`.
 *
 * It is per concept and not per topic on purpose: "Big-O of a hash lookup" and
 * "write a hash function" live in the same topic and want different formats.
 * Mirrors `concept_domain` in db/schema.ts (T-079).
 */
export const ConceptDomainSchema = z.enum(['code', 'math', 'systems', 'prose']);

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
    /**
     * The language the topic's code and examples are written in (T-091).
     *
     * Optional, and absent is a real answer: the learner may say "doesn't
     * matter", and plenty of topics have no language at all. 40 characters is
     * generous for "TypeScript" and short enough that this cannot become a
     * paragraph of instructions smuggled into every generator prompt.
     */
    language: z.string().trim().min(1).max(40).optional(),
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
//
// `prompt` stays required on every variant even once an item carries blocks
// (T-080). It is the accessible label, the extension's plain-text fallback, and
// what every item generated before blocks existed already has — so nothing that
// reads an item has to learn about blocks to keep working.
const itemFields = {
  recall: { type: z.literal('recall'), prompt: z.string().min(1), answer: z.string().min(1), accept: z.array(z.string()).optional() },
  recognition: {
    type: z.literal('recognition'),
    prompt: z.string().min(1),
    options: z.array(z.string()).length(4),
    answerIndex: z.number().int().min(0).max(3),
  },
  application: { type: z.literal('application'), prompt: z.string().min(1), answer: z.string().min(1), accept: z.array(z.string()).optional() },
  // 200 chars is what items/system.md calls a hard limit, and it was not one:
  // nothing checked it. The rubric is re-sent on every grade, and a bloated one
  // grades worse — it stops being a checklist and becomes prose to interpret.
  // 108 real rubrics across three generations top out at 169, so this rejects
  // nothing that exists.
  explain: { type: z.literal('explain'), prompt: z.string().min(1), rubric: z.string().min(1).max(200) },
};

/**
 * Cross-block rules — the ones a single block cannot check about itself.
 *
 * Shared by the stored and the generation union, because a model that emits two
 * answer blocks and a worker that stores two are the same bug arriving by
 * different routes.
 */
function itemBlockRules(item: { type: string; blocks?: { kind: string; slot: string }[] }, ctx: z.RefinementCtx): void {
  const blocks = item.blocks;
  if (!blocks) return;

  const count = (slot: string) => blocks.filter((b) => b.slot === slot).length;

  // Two answer surfaces means two things graded as one boolean, and every
  // pilot number sliced by `item.type` stops meaning anything.
  if (count('answer') > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['blocks'], message: 'an item may have at most one answer block' });
  }
  if (count('context') > 3) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['blocks'], message: 'at most 3 context blocks' });
  }
  if (count('reveal') > 2) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['blocks'], message: 'at most 2 reveal blocks' });
  }

  // `recognition` grades by index and `explain` grades against a rubric;
  // neither can grade a hole or a clicked line. Their answer surface is the one
  // they already have, so a code listing on a recognition item is *context* —
  // which is exactly how "predict the output" is built.
  if ((item.type === 'recognition' || item.type === 'explain') && count('answer') > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['blocks'],
      message: `a ${item.type} item cannot carry an answer block — its answer surface is ${item.type === 'recognition' ? 'options' : 'the rubric'}`,
    });
  }
}

// Generic so each variant keeps its `type` literal — a `z.ZodRawShape`
// parameter widens it to ZodTypeAny and discriminatedUnion loses its
// discriminator.
const payloadVariant = <T extends z.ZodRawShape>(fields: T) =>
  z.object({ ...fields, blocks: optionalOrNull(z.array(BlockSchema).min(1).max(6)) });

export const ItemPayloadSchema = z
  .discriminatedUnion('type', [
    payloadVariant(itemFields.recall),
    payloadVariant(itemFields.recognition),
    payloadVariant(itemFields.application),
    payloadVariant(itemFields.explain),
  ])
  .superRefine(itemBlockRules);

/**
 * What the model may return, as opposed to what we store (T-080).
 *
 * Every difference lives in `BlockGenerationSchema`: no line numbers, no field
 * that isn't listed. The worker derives the payload from this — see
 * `src/generator/blocks.ts`.
 */
// `optionalOrNull`, not `.optional()`: the provider's strict mode requires every
// property in `required`, so a plain-prompt item arrives as `blocks: null`
// rather than with the key missing (T-083).
const generationVariant = <T extends z.ZodRawShape>(fields: T) =>
  z.object({ ...fields, blocks: optionalOrNull(z.array(BlockGenerationSchema).min(1).max(6)) });

export const ItemGenerationSchema = z
  .discriminatedUnion('type', [
    generationVariant(itemFields.recall),
    generationVariant(itemFields.recognition),
    generationVariant(itemFields.application),
    generationVariant(itemFields.explain),
  ])
  .superRefine(itemBlockRules);

// Client-facing view of an item: no answer/accept/answerIndex/rubric (plan.md §6,
// T-010). `options` is present only for recognition items; `blocks` only for
// items that have them, already stripped of every answer key and with every
// `reveal` block dropped (T-080).
export const PublicItemSchema = z.object({
  itemId: z.string().uuid(),
  conceptId: z.string().uuid(),
  type: ItemTypeSchema,
  prompt: z.string(),
  options: z.array(z.string()).length(4).optional(),
  blocks: z.array(PublicBlockSchema).optional(),
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
  /**
   * The seven days are over and the topic has gone quiet until the day-30 test.
   * Distinct from `completedToday`, which means "come back tomorrow" — here
   * there is no tomorrow to come back to, and saying so is the difference
   * between a finished course and an app that looks broken.
   */
  courseComplete: z.boolean(),
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

// ---------- Cold test (Day-30; plan.md drops Day-45) ----------
export const TestStartSchema = z.object({
  kind: z.literal('day30'),
}).strict();

export const TestSubmitSchema = z.object({
  itemId: z.string().uuid(),
  response: z.union([z.string().max(10_000), z.number().finite()]).nullable(),
  confidence: ConfidenceSchema.unwrap(),
  latencyMs: z.number().int().nonnegative(),
});

export const TestScoresSchema = z.object({
  overall: z.number().min(0).max(1),
  taught: z.number().min(0).max(1).nullable(),
  heldOut: z.number().min(0).max(1).nullable(),
  transfer: z.number().min(0).max(1).nullable(),
  calibrationGap: z.number().min(-1).max(1),
  perConcept: z.record(z.string().uuid(), z.number().min(0).max(1)),
});

export const TestNextSchema = z.object({
  testId: z.string().uuid(),
  done: z.boolean(),
  completed: z.boolean(),
  item: PublicItemSchema.nullable(),
  progress: z.object({ answered: z.number().int().nonnegative(), total: z.number().int().positive() }),
  estimatedSeconds: z.number().int().positive(),
  scores: TestScoresSchema.optional(),
});

export const TestAvailabilitySchema = z.object({
  testId: z.string().uuid().nullable(),
  state: z.string(),
  jobId: z.string().optional(),
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
