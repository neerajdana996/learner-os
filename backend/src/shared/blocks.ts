// SOURCE OF TRUTH for the block system (T-080). Synced to frontend/src/shared
// and extension/src/shared by scripts/sync-shared.sh — never edit the copies.
//
// Browser-safe: only `zod` may be imported here (plan.md §5).
//
// A question used to be a prompt string and a textarea, whatever the subject. A
// prompt string cannot ask about an off-by-one, so an item may instead carry an
// ordered array of blocks in three slots:
//
//   context · 0–3   what the learner reads. Never interactive.
//   answer  · 0–1   the one thing the learner does.
//   reveal  · 0–2   shown only AFTER answering — the working version, the real
//                   output, why the near-miss was a near-miss.
//
// `item.type` still decides the cognitive act — recall, recognition,
// application, explain — because every pilot number is sliced by it. Blocks
// only decide what that act looks like. A fill-in-the-blank is still an
// `application` item; it is just no longer a textarea.
//
// ── TWO SCHEMAS, NOT ONE ──────────────────────────────────────────────────
// `BlockGenerationSchema` is what the model may return. `BlockSchema` is what
// we store, derived from the first by the worker. They differ in exactly two
// ways, and both are load-bearing:
//
//  1. **No model-writable field accepts markup, and every generation block is
//     `.strict()`.** Model-authored SVG or pre-highlighted HTML rendered into
//     the session page is script execution. Because the model cannot emit any
//     field that isn't listed here, it cannot emit markup — and no later task
//     can "simplify" by letting it without deleting a rule on purpose.
//  2. **The model never emits a line *number*.** It miscounts them constantly.
//     It quotes the line *text* instead (`lineQuote`), and the worker matches
//     that against `src` to compute the index — failing loudly when the quote
//     matches zero lines or two. A wrong number is invisible until a learner
//     sees an annotation pointing at the wrong line; an unmatched quote is
//     caught in the worker, before anything is stored.
import { z } from 'zod';

/**
 * Languages a listing may declare.
 *
 * Closed, because the value is what the highlighter switches on (T-084) — an
 * unknown language would render unhighlighted with nobody told. Adding one is
 * deliberately a two-file change: this list and a grammar.
 *
 * `plain` is a real answer, not a fallback: pseudocode, config, and the output
 * side of a diff are all legitimately unhighlighted.
 *
 * These are slugs, not the learner-facing names `T-095`'s onboarding offers
 * ("C++" there, `cpp` here). Mapping between the two is `T-094`'s problem, when
 * it checks that a listing is in the language that was asked for.
 */
export const LangSchema = z.enum([
  'javascript',
  'typescript',
  'python',
  'java',
  'go',
  'cpp',
  'sql',
  'bash',
  'json',
  'plain',
]);

/** Where a block sits. See the header — this is the renderer's whole contract. */
export const BlockSlotSchema = z.enum(['context', 'answer', 'reveal']);

/** Kinds whose slot must be `answer`. Everything else is content. */
export const ANSWER_BLOCK_KINDS = ['clozeCode', 'hotspotLine', 'orderLines', 'codeEditor'] as const;
export type AnswerBlockKind = (typeof ANSWER_BLOCK_KINDS)[number];

const MAX_SRC = 1200;
const MAX_SHORT = 400;
/** The extension popup is 380×300. Nine lines scrolls, and a card that scrolls
 *  is a card that gets dismissed (T-089 decides what may pop; this is the cap
 *  the `short` variant is written against). */
export const SHORT_MAX_LINES = 8;
/**
 * Lines in a listing (T-083's "hard limits").
 *
 * Enforced rather than merely asked for, because `domains/code.md` calls it a
 * hard limit and tells the model which rules are checked — an unchecked "hard"
 * limit teaches it that the checked ones are negotiable too. Twelve is what
 * fits a session card without scrolling; the extension's eight-line `short` is
 * a separate, tighter cap.
 */
export const SRC_MAX_LINES = 12;

export function lineCount(src: string): number {
  return src.split('\n').length;
}

/**
 * An optional field that also accepts `null`.
 *
 * The provider's strict mode requires *every* property to be listed in
 * `required`, so an absent optional arrives as an explicit `null` rather than
 * by omission (T-083) — and `.optional()` on its own rejects null. Normalised
 * back to `undefined` here so one shape covers what the model sends and what we
 * store, instead of the two drifting apart.
 */
export const optionalOrNull = <T extends z.ZodTypeAny>(schema: T) =>
  schema.nullish().transform((v) => v ?? undefined);

const opt = optionalOrNull;

// ---------- line references ----------
// Payload form: a 1-based index the renderer can use directly.
const NoteSchema = z.object({
  line: z.number().int().min(1),
  text: z.string().trim().min(1).max(120),
});

const LineRangeSchema = z
  .object({ from: z.number().int().min(1), to: z.number().int().min(1) })
  .refine((r) => r.to >= r.from, { message: 'dim.to must not be before dim.from' });

// Generation form: the quoted text of the line, which the worker resolves.
const NoteGenerationSchema = z
  .object({ lineQuote: z.string().trim().min(1), text: z.string().trim().min(1).max(120) })
  .strict();

const LineRangeGenerationSchema = z
  .object({ fromQuote: z.string().trim().min(1), toQuote: z.string().trim().min(1) })
  .strict();

// ---------- content blocks ----------
const proseFields = { text: z.string().trim().min(1).max(600) };

const codeFields = {
  lang: LangSchema,
  src: z.string().min(1).max(MAX_SRC),
  /** ≤8 lines, for the extension popup. Identifiers may be elided to `…`;
   *  the line the question is about may not be. */
  short: opt(z.string().min(1).max(MAX_SHORT)),
};

const codeDiffFields = {
  lang: LangSchema,
  /** Before and after, not rows: the renderer computes the +/− rows, the same
   *  way it computes highlighting. The model writes two listings. */
  before: z.string().min(1).max(MAX_SRC),
  after: z.string().min(1).max(MAX_SRC),
  caption: opt(z.string().trim().min(1).max(160)),
};

const terminalFields = {
  command: opt(z.string().trim().min(1).max(200)),
  lines: z
    .array(
      z.object({
        text: z.string().max(300),
        /** `err` carries the stack trace. Colour is never the only signal —
         *  the renderer marks the stream as well (T-085). */
        stream: z.enum(['out', 'err']).default('out'),
      }),
    )
    .min(1)
    .max(20),
};

// ---------- answer blocks ----------
const clozeCodeFields = {
  lang: LangSchema,
  /** Holes are written `{{1}}`, `{{2}}` inline. Every marker needs a hole and
   *  every hole needs a marker — either way round is a silent blank at runtime. */
  src: z.string().min(1).max(MAX_SRC),
  holes: z
    .array(
      z.object({
        id: z.number().int().min(1),
        answer: z.string().trim().min(1).max(60),
        accept: z.array(z.string().trim().min(1)).max(6).default([]),
        /** Rendered as `width: {n}ch` — the one place a style value comes from
         *  data, because a 3-character hole and a 20-character hole are
         *  different questions. */
        width: z.number().int().min(1).max(24),
      }),
    )
    .min(1)
    .max(2),
  /**
   * Required, not optional, and this is the cheapest quality gate in the whole
   * generator. It is the sentence naming the concrete input where the most
   * likely wrong answer breaks — "search([4], 4) returns -1". A model that
   * cannot write it has not written an item about a boundary; it has written an
   * item about syntax it happened to delete. Being required means Zod rejects
   * the item and the generator retries, without a human ever seeing it.
   */
  failure: z.string().trim().min(1).max(240),
};

const hotspotLineCommon = {
  lang: LangSchema,
  src: z.string().min(1).max(MAX_SRC),
  /** Shown after answering. */
  why: z.string().trim().min(1).max(240),
  /** Required, for the same reason `clozeCode.failure` is (T-083): the concrete
   *  input where the marked line actually breaks. Falsifiable, so a model that
   *  picked the line because it looked complicated cannot write it. */
  failure: z.string().trim().min(1).max(240),
  /**
   * The honest catch in this format: when the fix is an *insertion*, the line
   * that "has to change" is an absence, and you cannot click a line that is not
   * there. So the generator marks the line that has to change and sets this to
   * accept its immediate neighbour.
   */
  acceptAdjacent: z.boolean().default(false),
};

const orderLinesCommon = {
  lang: LangSchema,
  /**
   * Which two lines, swapped, break it — and what breaks (T-083).
   *
   * An ordering question is only worth 30 seconds if the order matters. If no
   * pair can be named, the lines are independent and this should have been a
   * plain item.
   */
  swapBreaks: z.string().trim().min(1).max(240),
};

const codeEditorCommon = {
  lang: LangSchema,
  /** What the learner is writing against, e.g. `debounce(fn, ms)`. */
  signature: z.string().trim().min(1).max(200),
  /** What is in the editor when they arrive. Never the answer. */
  starter: z.string().min(1).max(MAX_SRC),
  /**
   * "Show me the shape" — the skeleton with the bodies blank. Taking it sets
   * `review_events.assisted` (T-079) and the scheduler treats the answer as a
   * lapse regardless of the cases going green, because otherwise day 30 comes
   * as a shock. Never in the public payload; it is fetched when taken (T-088).
   */
  skeleton: z.string().min(1).max(MAX_SRC),
  /**
   * What writing the whole function tests that a blank would not (T-083).
   *
   * Four minutes is a quarter of the daily budget, so this block has to earn
   * it. "Could you actually do it" is the only answer that does; if the real
   * question is whether they remember a keyword, a `clozeCode` costs twenty
   * seconds and measures the same thing.
   */
  whyWhole: z.string().trim().min(1).max(240),
  cases: z
    .array(
      z.object({
        /** The human sentence: "Three rapid calls run fn once". */
        name: z.string().trim().min(1).max(160),
        /** The code that exercises it. Public — it is the spec, not a surprise. */
        call: z.string().trim().min(1).max(300),
        /**
         * The answer key. Never public: the expected output of three named
         * cases largely gives the function away.
         *
         * Not checkable here that the first case passes the empty starter — the
         * design's rule, and a good one, because three reds on the first run is
         * a blank page rather than a debugging problem. It needs the code to
         * actually run, so it belongs to T-088.
         */
        expect: z.string().max(300),
      }),
    )
    .min(2)
    .max(4),
};

// ---------- the stored union ----------
const block = <K extends string, T extends z.ZodRawShape>(kind: K, fields: T) =>
  z.object({ kind: z.literal(kind), slot: BlockSlotSchema, ...fields });

const ProseBlockSchema = block('prose', proseFields);
const CodeBlockSchema = block('code', {
  ...codeFields,
  notes: z.array(NoteSchema).max(3).default([]),
  dim: opt(LineRangeSchema),
});
const CodeDiffBlockSchema = block('codeDiff', codeDiffFields);
const TerminalBlockSchema = block('terminal', terminalFields);

const ClozeCodeBlockSchema = block('clozeCode', clozeCodeFields);
const HotspotLineBlockSchema = block('hotspotLine', {
  ...hotspotLineCommon,
  line: z.number().int().min(1),
});
const OrderLinesBlockSchema = block('orderLines', {
  ...orderLinesCommon,
  /** In the order the learner sees them — shuffled once by the worker, so every
   *  learner on this topic gets the same puzzle. */
  lines: z.array(z.string().trim().min(1).max(200)).min(4).max(6),
  /** Indices into `lines`, in the correct sequence. The answer key. */
  order: z.array(z.number().int().min(0)).min(4).max(6),
});
const CodeEditorBlockSchema = block('codeEditor', codeEditorCommon);

/** Every block kind, stored form. */
export const BlockSchema = z
  .discriminatedUnion('kind', [
    ProseBlockSchema,
    CodeBlockSchema,
    CodeDiffBlockSchema,
    TerminalBlockSchema,
    ClozeCodeBlockSchema,
    HotspotLineBlockSchema,
    OrderLinesBlockSchema,
    CodeEditorBlockSchema,
  ])
  .superRefine(blockRules);

// ---------- the generation union ----------
// Same shapes, minus every line number and plus `.strict()`, so an unlisted
// field — `svg`, `tokens`, anything a later task adds to the stored form — is
// rejected rather than carried through.
const genBlock = <K extends string, T extends z.ZodRawShape>(kind: K, fields: T) =>
  z.object({ kind: z.literal(kind), slot: BlockSlotSchema, ...fields }).strict();

export const BlockGenerationSchema = z
  .discriminatedUnion('kind', [
    genBlock('prose', proseFields),
    genBlock('code', {
      ...codeFields,
      notes: z.array(NoteGenerationSchema).max(3).default([]),
      dim: opt(LineRangeGenerationSchema),
    }),
    genBlock('codeDiff', codeDiffFields),
    genBlock('terminal', terminalFields),
    genBlock('clozeCode', clozeCodeFields),
    genBlock('hotspotLine', { ...hotspotLineCommon, lineQuote: z.string().trim().min(1) }),
    genBlock('orderLines', {
      ...orderLinesCommon,
      /** In the CORRECT order. The worker shuffles and records `order`; asking
       *  the model to emit a permutation of its own list is a needless way to
       *  get an off-by-one. */
      lines: z.array(z.string().trim().min(1).max(200)).min(4).max(6),
    }),
    genBlock('codeEditor', codeEditorCommon),
  ])
  .superRefine(blockRules);

// ---------- the public projection ----------
// Answer keys are stripped by building the client shape field by field, never
// by deleting keys — so a field added to a block later is excluded by default
// instead of leaking until someone remembers it. Same doctrine as
// `toPublicItem` (T-010), for the same reason.
const PublicCodeEditorCaseSchema = z.object({ name: z.string(), call: z.string() });

export const PublicBlockSchema = z.discriminatedUnion('kind', [
  block('prose', proseFields),
  block('code', { ...codeFields, notes: z.array(NoteSchema).max(3), dim: opt(LineRangeSchema) }),
  block('codeDiff', codeDiffFields),
  block('terminal', terminalFields),
  block('clozeCode', {
    lang: LangSchema,
    src: z.string(),
    holes: z.array(z.object({ id: z.number().int(), width: z.number().int() })),
  }),
  block('hotspotLine', { lang: LangSchema, src: z.string() }),
  block('orderLines', { lang: LangSchema, lines: z.array(z.string()) }),
  block('codeEditor', {
    lang: LangSchema,
    signature: z.string(),
    starter: z.string(),
    cases: z.array(PublicCodeEditorCaseSchema),
  }),
]);

export type Block = z.infer<typeof BlockSchema>;
export type BlockGeneration = z.infer<typeof BlockGenerationSchema>;
export type PublicBlock = z.infer<typeof PublicBlockSchema>;
export type Lang = z.infer<typeof LangSchema>;
export type BlockSlot = z.infer<typeof BlockSlotSchema>;

/**
 * One block, stripped for the client.
 *
 * `reveal` blocks are not stripped — they are dropped entirely by
 * `toPublicBlocks`, because a reveal block *is* the answer: the working version
 * of the code, the real output. Nothing here is reachable for one.
 */
export function toPublicBlock(b: Block): PublicBlock {
  const base = { slot: b.slot };
  switch (b.kind) {
    case 'prose':
      return { ...base, kind: 'prose', text: b.text };
    case 'code':
      return { ...base, kind: 'code', lang: b.lang, src: b.src, short: b.short, notes: b.notes, dim: b.dim };
    case 'codeDiff':
      return { ...base, kind: 'codeDiff', lang: b.lang, before: b.before, after: b.after, caption: b.caption };
    case 'terminal':
      return { ...base, kind: 'terminal', command: b.command, lines: b.lines };
    // `answer`, `accept` and `failure` stay behind: `failure` names the input
    // where the near-miss breaks, which is the hint, shown after answering.
    case 'clozeCode':
      return {
        ...base,
        kind: 'clozeCode',
        lang: b.lang,
        src: b.src,
        holes: b.holes.map((h) => ({ id: h.id, width: h.width })),
      };
    // `line`, `acceptAdjacent`, `why` and `failure` stay behind — grading is
    // server-side and `failure` is the hint, shown after answering.
    case 'hotspotLine':
      return { ...base, kind: 'hotspotLine', lang: b.lang, src: b.src };
    case 'orderLines':
      return { ...base, kind: 'orderLines', lang: b.lang, lines: b.lines };
    // `expect`, `skeleton` and the model solution stay behind. That forces the
    // client runner to post actual outputs and let the server compare (T-088) —
    // which is also what makes a JS item indistinguishable from a Python one,
    // as the design requires.
    case 'codeEditor':
      return {
        ...base,
        kind: 'codeEditor',
        lang: b.lang,
        signature: b.signature,
        starter: b.starter,
        cases: b.cases.map((c) => ({ name: c.name, call: c.call })),
      };
  }
}

/** Every block a client may see for an unanswered item. */
export function toPublicBlocks(blocks: Block[]): PublicBlock[] {
  return blocks.filter((b) => b.slot !== 'reveal').map(toPublicBlock);
}

/**
 * The value for `items.answer_kind` (T-079) — the one thing denormalised out of
 * the payload, because the extension's due-item pick has to exclude formats
 * that cannot render in a popup and `payload->'blocks'` is not indexable.
 *
 * Null means "plain prompt", which is every item generated before T-080.
 */
export function answerKindOf(blocks: Block[] | undefined): AnswerBlockKind | null {
  const answer = blocks?.find((b) => b.slot === 'answer');
  return answer ? (answer.kind as AnswerBlockKind) : null;
}

function isAnswerKind(kind: string): kind is AnswerBlockKind {
  return (ANSWER_BLOCK_KINDS as readonly string[]).includes(kind);
}

/**
 * What Zod refuses, so a human never has to. Shared by both unions — every rule
 * here is about a single block's internal consistency; the cross-block rules
 * (one answer, slot counts) live on the item, in schemas.ts.
 */
function blockRules(b: Record<string, unknown>, ctx: z.RefinementCtx): void {
  const kind = b.kind as string;
  const slot = b.slot as string;

  // Categories cannot borrow each other's renderers by accident, and the three
  // slots are the renderer's entire contract.
  if (isAnswerKind(kind) && slot !== 'answer') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['slot'], message: `${kind} is an answer block and must have slot "answer"` });
  }
  if (!isAnswerKind(kind) && slot === 'answer') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['slot'], message: `${kind} is a content block and cannot have slot "answer"` });
  }

  if (typeof b.src === 'string' && lineCount(b.src) > SRC_MAX_LINES) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['src'],
      message: `listing is ${lineCount(b.src)} lines; the limit is ${SRC_MAX_LINES}`,
    });
  }

  if (kind === 'code') {
    const src = b.src as string;
    const n = lineCount(src);
    for (const [i, note] of ((b.notes ?? []) as { line?: number }[]).entries()) {
      // Only the stored form carries numbers; the generation form is quotes,
      // resolved and re-validated by the worker.
      if (typeof note.line === 'number' && note.line > n) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['notes', i, 'line'],
          message: `note points at line ${note.line} of a ${n}-line listing`,
        });
      }
    }
    const dim = b.dim as { to?: number } | undefined;
    if (dim && typeof dim.to === 'number' && dim.to > n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dim', 'to'], message: `dim ends past line ${n}` });
    }
    checkShort(b, ctx, n);
  }

  if (kind === 'clozeCode') {
    const src = b.src as string;
    const holes = (b.holes ?? []) as { id: number }[];
    const markers = new Set([...src.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1])));
    const ids = new Set(holes.map((h) => h.id));
    for (const id of markers) {
      if (!ids.has(id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['src'], message: `src has a {{${id}}} marker with no matching hole` });
      }
    }
    for (const [i, hole] of holes.entries()) {
      if (!markers.has(hole.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['holes', i, 'id'], message: `hole ${hole.id} has no {{${hole.id}}} marker in src` });
      }
    }
    if (ids.size !== holes.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['holes'], message: 'two holes share an id' });
    }
  }

  if (kind === 'hotspotLine' && typeof b.line === 'number') {
    const n = lineCount(b.src as string);
    if ((b.line as number) > n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['line'], message: `hotspot points at line ${b.line} of a ${n}-line listing` });
    }
  }

  if (kind === 'orderLines' && Array.isArray(b.order)) {
    const lines = b.lines as string[];
    const order = b.order as number[];
    const expected = [...lines.keys()].sort((x, y) => x - y).join(',');
    if (order.length !== lines.length || [...order].sort((x, y) => x - y).join(',') !== expected) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['order'], message: 'order must be a permutation of every line index, exactly once' });
    }
  }

  if (kind === 'codeEditor') {
    const cases = (b.cases ?? []) as { name: string }[];
    if (new Set(cases.map((c) => c.name)).size !== cases.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cases'], message: 'two cases share a name' });
    }
  }
}

/**
 * The `short` variant is what the extension pops. Two rules: it fits, and it
 * did not elide the line the question is about — a popup showing eight lines of
 * setup with the interesting one replaced by `…` is a question about nothing.
 */
function checkShort(b: Record<string, unknown>, ctx: z.RefinementCtx, _srcLines: number): void {
  const short = b.short as string | undefined;
  if (!short) return;

  if (lineCount(short) > SHORT_MAX_LINES) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['short'],
      message: `short is ${lineCount(short)} lines; the popup fits ${SHORT_MAX_LINES}`,
    });
  }

  // Only checkable against notes, which are what mark a line as interesting.
  // Both forms are handled: the stored `line` and the generated `lineQuote`.
  const src = (b.src as string).split('\n');
  for (const [i, note] of ((b.notes ?? []) as { line?: number; lineQuote?: string }[]).entries()) {
    const text = typeof note.line === 'number' ? src[note.line - 1] : note.lineQuote;
    if (text && !short.includes(text.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['short'],
        message: `short elided the line note ${i + 1} points at`,
      });
    }
  }
}
