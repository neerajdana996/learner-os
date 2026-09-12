import { z } from 'zod';
import { definePrompt, runPrompt, stripFences, LlmError } from '../llm/index.js';
import { ItemPayloadSchema, LangSchema, BlockSlotSchema, DRAWING_ALT_MAX, type ItemPayload } from '@learnos/shared';
import { parseGeneratedItemBlocks } from './blocks.js';

/** sprint.md's Sprint 1 demo expects 6–8 items per taught concept. */
export const MIN_ITEMS = 6;
/**
 * How many of a concept's items may use a rich answer format (T-083).
 *
 * Two, out of six to eight. `clozeCode` is 15–30s and `hotspotLine` 8–15s
 * against a plain item's ~10s, and a concept comes back three or four times
 * inside the teaching week — so the cap is really a cap on the *review* budget,
 * not on this one generation.
 */
export const MAX_RICH_ITEMS = 2;

import { GenerationError, type GenerationErrorReason } from './errors.js';
import { failer, isRepairable, type ValidateOptions } from './severity.js';

/** The batch's domain — the same value that selects the prompt fragment, so
 *  "a block was authorised" and "a block was asked for" cannot diverge. */
interface ItemsValidateOptions extends ValidateOptions {
  domain?: string | undefined;
  /** See the teaching option of the same name: the retry hook has no domain,
   *  and a block nobody asked for is dropped rather than re-requested. */
  enforceBlockDomain?: boolean;
}

export { GenerationError, type GenerationErrorReason };

export interface GeneratedItem {
  payload: ItemPayload;
  isTransfer: boolean;
}

export interface GeneratedItems {
  topic: string;
  items: GeneratedItem[];
}

/**
 * One batch: several neighbouring concepts, written together (T-162).
 *
 * Generating a concept at a time is what produced four questions with the same
 * one-word answer inside one concept, and near-duplicates across neighbouring
 * ones — each call was doing its best with the only thing it could see. A batch
 * lets the model differentiate deliberately, and makes the discrimination item
 * ("tell this from its neighbour") writable at all: `items/system.md` has asked
 * for one since T-FIX-006 while the call was never told what the neighbours
 * were.
 */
export interface GeneratedItemsBatch {
  topic: string;
  /** Keyed by concept slug, one entry per slug requested. */
  bySlug: Map<string, GeneratedItem[]>;
}

const BatchResponseSchema = z.object({
  concepts: z
    .array(z.object({ slug: z.string().min(1), items: z.array(z.unknown()).min(1) }))
    .min(1),
});

/**
 * A prompt pointing at an artefact the item does not carry (T-125).
 *
 * The artefact has to be **named**: "the history shown", "the code below", "in
 * the diagram". A bare "shown" is not enough — "what must be shown to prove the
 * property" is ordinary mathematical prose and appears in the real database.
 * Nor does this match "which of the following", "the cell above" or "the node
 * above it in the tree". Rejecting those would cost good items to catch a rare
 * bad one.
 */
export const REFERS_TO_SHOWN =
  /\b(?:(?:diagram|figure|snippet|listing|history|table|code|output|graph|sequence)\s+(?:shown|below|above)|(?:in|from)\s+the\s+(?:diagram|figure|snippet|listing|history|table|graph|sequence)\b)/i;

const RawItemsResponseSchema = z.object({
  topic: z.string().min(1),
  items: z.array(z.unknown()).min(1),
});

/**
 * One raw item from the model → the row we store.
 *
 * Two schemas, not one (T-080). `ItemGenerationSchema` is what the model may
 * return — strict blocks, line *quotes*, no field that isn't listed — and
 * `parseGeneratedItemBlocks` resolves those quotes into indices. The result is
 * then parsed again as an `ItemPayload`, which is not belt-and-braces: it is
 * what catches a resolver that produced a note pointing past the end of a
 * listing.
 *
 * `isTransfer` is pulled out separately because it lives alongside `payload` on
 * the `items` row, not inside the jsonb payload itself.
 */
function parseGeneratedItem(raw: unknown): GeneratedItem {
  const resolved = parseGeneratedItemBlocks(raw);

  const result = ItemPayloadSchema.safeParse(resolved);
  if (!result.success) {
    const type = (raw as { type?: unknown } | null)?.type;
    const label = typeof type === 'string' ? type : 'item';
    throw new GenerationError(
      'invalid_shape',
      `invalid ${label} payload after resolving blocks: ${result.error.issues.map((i) => i.message).join('; ')}`,
    );
  }
  const isTransfer = (raw as { isTransfer?: unknown } | null)?.isTransfer;
  if (typeof isTransfer !== 'boolean') {
    throw new GenerationError('invalid_shape', `${result.data.type} item is missing a boolean isTransfer flag`);
  }
  return { payload: result.data, isTransfer };
}

export function parseItemsResponse(raw: string): GeneratedItems {
  return validateItems(JSON.parse(stripFences(raw)));
}

/**
 * Per-item shape + the cross-item rules. Size-agnostic on purpose so it can be
 * unit tested with small sets; the 6-item floor is a batch-level check in
 * `validateItemsBatch`, which is what `runPrompt`'s retry hook calls.
 *
 * Pass `{ tolerate: true }` to downgrade the preference rules — transfer count,
 * rich-format count — to warnings (T-164).
 */
export function validateItems(data: unknown, options: ValidateOptions = {}): GeneratedItems {
  const fail = failer('items', options.tolerate);
  const { topic, items: rawItems } = RawItemsResponseSchema.parse(data);
  const items = rawItems.map(parseGeneratedItem);

  const types = new Set(items.map((item) => item.payload.type));
  if (!types.has('recall') || !types.has('recognition') || !types.has('application') || !types.has('explain')) {
    throw new GenerationError('missing_item_type', 'all four item types are required');
  }

  const transferCount = items.filter((item) => item.isTransfer).length;
  if (transferCount === 0) {
    fail('transfer_count', 'at least one item must be marked as transfer');
  }
  if (transferCount > 2) {
    fail('transfer_count', 'no more than 2 transfer items allowed');
  }

  for (const item of items) {
    if (item.payload.type === 'explain' && item.payload.rubric.length > 200) {
      throw new GenerationError('explain_rubric', 'explain rubric must be 200 characters or less');
    }
  }

  /**
   * A question may not point at something the learner cannot see (T-125).
   *
   * **Preventive, not a repair.** Checked against all 1312 items in the
   * database: none violate it. The one that looked like a violation —
   * *"Which operations overlap in the history shown?"* — turned out to carry a
   * block after all, so the history *was* shown. The rule exists because the
   * failure is unanswerable when it does happen, and one unanswerable question
   * makes a learner distrust every other one.
   *
   * The pattern is deliberately narrow. "The cell above", "the node above it in
   * the tree" and "which of the following" are all legitimate prose that a
   * looser rule would reject; this only fires on a reference to a *shown*
   * artefact, and only when the item carries no block to show one.
   */
  for (const item of items) {
    if (item.payload.blocks?.length) continue;
    if (REFERS_TO_SHOWN.test(item.payload.prompt)) {
      throw new GenerationError(
        'dangling_reference',
        `item refers to something shown but carries no block: "${item.payload.prompt.slice(0, 80)}"`,
      );
    }
  }

  // Every format decision is a time decision (T-083). The learner has ~15
  // minutes and today already holds two new concepts plus six reviews, so a
  // concept whose whole review history is 25-second questions is a concept
  // that stops getting reviewed. Rich formats carry the concept; plain items
  // carry the volume.
  const rich = items.filter((item) => item.payload.blocks?.some((block) => block.slot === 'answer')).length;
  if (rich > MAX_RICH_ITEMS) {
    fail(
      'too_many_rich',
      `${rich} items use a rich answer format; at most ${MAX_RICH_ITEMS} per concept`,
    );
  }

  return { topic, items };
}

/**
 * A batch response: every per-concept rule, plus the ones that only exist
 * because several concepts were written together (T-162).
 *
 * Per-concept checks are delegated to `validateItems` rather than reimplemented
 * — the four types, the transfer count, the rubric limit, the dangling
 * reference and the rich-format cap all apply unchanged to each entry.
 */
/**
 * The batch failures worth retrying one concept at a time (T-164).
 *
 * A batch asks for up to four concepts and around thirty items in one reply,
 * and every rule below is one the model has to hold for *each* concept while
 * writing all of them. Asked about a single concept it has a fraction as much
 * to track, so the same rule usually holds on the second attempt — and the
 * split costs one small call rather than the whole course, which is what a
 * batch failure used to cost.
 *
 * Two reasons are deliberately absent. `missing_api_key` is not a content
 * problem and splitting would just produce four identical failures, and a
 * `refused` response is about what was asked, which does not change when it is
 * asked alone.
 */
export const SPLITTABLE_BATCH_REASONS: ReadonlySet<GenerationErrorReason> = new Set([
  // Per-concept rules the model dropped while juggling four of them.
  'missing_item_type',
  'transfer_count',
  'explain_rubric',
  'too_few_items',
  'dangling_reference',
  'too_many_rich',
  // Cross-concept rules. Splitting does not weaken them: `asked` still carries
  // every prompt written so far, so a single-concept call is still checked
  // against its neighbours' questions.
  'duplicate_prompt',
  'item_cues_another',
  'batch_slug_mismatch',
  // Shape failures that a shorter reply genuinely fixes: four concepts of items
  // is the response most likely to run out of tokens or come back malformed.
  'truncated',
  'invalid_json',
  'invalid_shape',
]);

export function validateItemsBatch(
  data: unknown,
  topic: string,
  requested: string[],
  options: ItemsValidateOptions = {},
): GeneratedItemsBatch {
  const fail = failer('items', options.tolerate);
  const parsed = BatchResponseSchema.parse(data);

  const bySlug = new Map<string, GeneratedItem[]>();
  for (const entry of parsed.concepts) {
    if (bySlug.has(entry.slug)) {
      throw new GenerationError('batch_slug_mismatch', `slug ${entry.slug} appears twice in the batch`);
    }
    // Named, because `validateItems` was written for one concept and its
    // messages say "at least one item must be marked as transfer" with no way
    // to tell which of the four in a batch broke the rule. A failure here ends
    // the whole topic, so the log line that explains it has to be actionable.
    try {
      bySlug.set(entry.slug, validateItems({ topic, items: entry.items }, options).items);
    } catch (error) {
      if (error instanceof GenerationError) {
        // `error.message` already begins with the reason, and `GenerationError`
        // prefixes it again — so pass only the part after it, or the retry
        // prompt reads "missing_item_type: concept c1: missing_item_type: ...".
        const detail = error.message.slice(`${error.reason}: `.length);
        throw new GenerationError(error.reason, `concept ${entry.slug}: ${detail}`, error.raw);
      }
      throw error;
    }
  }

  /**
   * The per-concept floor, checked here rather than after the call (T-164).
   *
   * `generateItemsBatch` used to apply it on the way out, which put the one
   * rule whose fix is obviously "write two more questions" outside `runPrompt`'s
   * retry: no second attempt, no repair turn, just a dead topic. Here it is
   * inside the hook like every other rule, and it can name the concept.
   */
  for (const [slug, items] of bySlug) {
    if (items.length < MIN_ITEMS) {
      fail('too_few_items', `concept ${slug} got ${items.length} items, need at least ${MIN_ITEMS}`);
    }
  }

  /**
   * The other half of T-166: a block only where a domain section describes one.
   *
   * Making `blocks` visible in the generic prompt is what lets a `code` batch
   * write them at all — it was absent from the output contract and from the
   * example, so the model never wrote one, on any topic, ever. The risk of
   * making it visible is the failure the teaching side already had: blocks
   * appearing on `prose` and `math` concepts, in shapes nobody specified.
   *
   * A batch shares one domain (`batchConcepts` groups by it), so the check is
   * the same one the fragment selection makes, which is what keeps the rule and
   * the instruction from disagreeing.
   */
  if (options.enforceBlockDomain && domainFragment(options.domain) === undefined) {
    for (const [slug, items] of bySlug) {
      const withBlocks = items.filter((item) => item.payload.blocks?.length);
      if (withBlocks.length === 0) continue;
      fail(
        'block_without_domain',
        `concept ${slug} carries ${withBlocks.length} item(s) with blocks, but its domain ` +
          `(${options.domain ?? 'none'}) has no section describing one`,
      );
      bySlug.set(
        slug,
        items.map((item) => {
          if (!item.payload.blocks?.length) return item;
          const { blocks: _dropped, ...rest } = item.payload;
          return { ...item, payload: rest as typeof item.payload };
        }),
      );
    }
  }

  // Exactly the requested set. A missing slug silently leaves a concept with no
  // questions, which `getSession` treats as a bug rather than a race; an extra
  // one is items for a concept this batch was not asked about, and nothing
  // downstream has anywhere to put them.
  const wanted = new Set(requested);
  for (const slug of bySlug.keys()) {
    if (!wanted.has(slug)) {
      throw new GenerationError('batch_slug_mismatch', `batch returned items for unrequested concept ${slug}`);
    }
  }
  for (const slug of wanted) {
    if (!bySlug.has(slug)) {
      throw new GenerationError('batch_slug_mismatch', `batch returned no items for concept ${slug}`);
    }
  }

  const all = [...bySlug.entries()].flatMap(([slug, items]) => items.map((item) => ({ slug, item })));

  // The duplication this batching exists to prevent. Compared normalised,
  // because "What is a replica?" and "what is a replica" are the same question
  // to a learner meeting them four days apart.
  const seenPrompts = new Map<string, string>();
  for (const { slug, item } of all) {
    const key = normalisePrompt(item.payload.prompt);
    const first = seenPrompts.get(key);
    if (first !== undefined) {
      throw new GenerationError(
        'duplicate_prompt',
        `${slug} repeats a prompt already written for ${first}: "${item.payload.prompt.slice(0, 80)}"`,
      );
    }
    seenPrompts.set(key, slug);
  }

  // Cueing: one item handing over another's answer. They are days apart, but
  // they are the same set — a recognition option that spells out a recall
  // item's answer has scored that item for free, for every learner.
  const answers = all.flatMap(({ slug, item }) =>
    item.payload.type === 'recall' || item.payload.type === 'application'
      ? [{ slug, answer: normalisePrompt(item.payload.answer) }]
      : [],
  );
  for (const { slug, item } of all) {
    if (item.payload.type !== 'recognition') continue;
    for (const option of item.payload.options) {
      const normalised = normalisePrompt(option);
      // Short answers collide by accident ("yes", "O(n)"); only a substantial
      // one is evidence that the option restates another item's answer.
      if (normalised.length < 12) continue;
      const cued = answers.find((a) => a.answer === normalised && a.slug !== slug);
      if (cued) {
        throw new GenerationError(
          'item_cues_another',
          `an option on a ${slug} item is the exact answer to a ${cued.slug} item: "${option.slice(0, 80)}"`,
        );
      }
    }
  }

  return { topic, bySlug };
}

/** Lowercased, punctuation-stripped, whitespace-collapsed — the form in which
 *  two prompts are "the same question" to a learner, not to a string compare. */
function normalisePrompt(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The structural contract handed to the provider (T-FIX-011).
 *
 * Written out rather than derived from Zod: `zod/v4`'s converter cannot read
 * the v3 schema instances this project uses, and the two contracts are not the
 * same thing anyway. This one describes what the *model* must emit — every
 * field present, nothing extra — while `ItemPayloadSchema` keeps the
 * constraints strict mode ignores (exactly 4 options, 200-char rubric).
 * `itemsSchemaMatchesZod` in the tests pins them together.
 *
 * `isTransfer` sits on every variant because a model omitting it is exactly the
 * failure that broke real generation: it dropped the field on the `explain`
 * item, twice, through the retry.
 */
/**
 * Strict mode requires every property to appear in `required`, so an optional
 * field is expressed as a nullable type rather than by omission (T-083).
 */
const nullable = (schema: Record<string, unknown>) => ({ ...schema, type: [schema.type, 'null'] });

const str = { type: 'string' } as const;
const strArray = { type: 'array', items: str } as const;
/** Told to the model explicitly (T-158): matches `DRAWING_ALT_MAX`
 *  (@learnos/shared) — see the note beside `teaching.ts`'s copy of this. */
const altField = { type: 'string', maxLength: DRAWING_ALT_MAX } as const;
const LANGS = [...LangSchema.options];
const SLOTS = [...BlockSlotSchema.options];

/**
 * One block variant, in the shape the provider will accept.
 *
 * Written out rather than derived from Zod for the same reason the item
 * variants are — see the note above — but built from a helper because eight
 * hand-typed objects with `additionalProperties`, `required` and `properties`
 * kept in sync three times each is a transcription error waiting to happen.
 * `blocksSchemaMatchesZod` in the tests pins the two together.
 */
const blockVariant = (kind: string, properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'slot', ...Object.keys(properties)],
  properties: {
    kind: { type: 'string', enum: [kind] },
    slot: { type: 'string', enum: SLOTS },
    ...properties,
  },
});

const lang = { type: 'string', enum: LANGS } as const;

/**
 * The generation form of every block (T-080), offered to the provider so the
 * model can actually emit one.
 *
 * Every line reference is a *quote*, never a number — the model miscounts them
 * and the worker resolves the text against `src`. Nothing here accepts markup,
 * which is what makes model-authored SVG impossible rather than merely
 * discouraged.
 */
export const blockJsonSchemas = [
  blockVariant('prose', { text: str }),
  blockVariant('code', {
    lang,
    src: str,
    short: nullable(str),
    notes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['lineQuote', 'text'],
        properties: { lineQuote: str, text: str },
      },
    },
    dim: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['fromQuote', 'toQuote'],
      properties: { fromQuote: str, toQuote: str },
    },
  }),
  blockVariant('codeDiff', { lang, before: str, after: str, caption: nullable(str) }),
  blockVariant('terminal', {
    command: nullable(str),
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'stream'],
        properties: { text: str, stream: { type: 'string', enum: ['out', 'err'] } },
      },
    },
  }),
  blockVariant('clozeCode', {
    lang,
    src: str,
    holes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'answer', 'accept', 'width'],
        properties: { id: { type: 'integer' }, answer: str, accept: strArray, width: { type: 'integer' } },
      },
    },
    failure: str,
  }),
  blockVariant('hotspotLine', { lang, src: str, lineQuote: str, why: str, failure: str, acceptAdjacent: { type: 'boolean' } }),
  blockVariant('orderLines', { lang, lines: strArray, swapBreaks: str }),
  blockVariant('codeEditor', {
    lang,
    signature: str,
    starter: str,
    skeleton: str,
    whyWhole: str,
    cases: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'call', 'expect'],
        properties: { name: str, call: str, expect: str },
      },
    },
  }),
  // Systems (T-108). No `svg` on any of these: the worker draws it, and the
  // Zod generation form is `.strict()` so a model that sent one is rejected.
  blockVariant('diagram', {
    nodes: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['id', 'label'], properties: { id: str, label: str } },
    },
    edges: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['from', 'to', 'label'], properties: { from: str, to: str, label: nullable(str) } },
    },
    alt: altField,
  }),
  blockVariant('sequence', {
    lanes: strArray,
    messages: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['from', 'to', 'label', 'delayed'],
        properties: { from: str, to: str, label: str, delayed: { type: ['boolean', 'null'] } },
      },
    },
    alt: altField,
  }),
  blockVariant('numeric', { answer: { type: 'number' }, tolerance: { type: 'number' }, unit: nullable(str) }),
] as const;

/** Optional, so nullable — see `nullable`. A plain-prompt item sends `null`. */
const blocksProperty = { type: ['array', 'null'], items: { anyOf: [...blockJsonSchemas] } };

const textVariant = (type: 'recall' | 'application') => ({
  type: 'object',
  additionalProperties: false,
  required: ['type', 'prompt', 'answer', 'accept', 'isTransfer', 'blocks'],
  properties: {
    type: { type: 'string', enum: [type] },
    prompt: { type: 'string' },
    answer: { type: 'string' },
    accept: { type: 'array', items: { type: 'string' } },
    isTransfer: { type: 'boolean' },
    blocks: blocksProperty,
  },
});

const itemVariants = {
  anyOf: [
    textVariant('recall'),
    textVariant('application'),
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'prompt', 'options', 'answerIndex', 'distractorSource', 'isTransfer', 'blocks'],
      properties: {
        type: { type: 'string', enum: ['recognition'] },
        prompt: { type: 'string' },
        options: { type: 'array', items: { type: 'string' } },
        answerIndex: { type: 'integer' },
        // T-162. Required, so the model cannot quietly skip the one field that
        // proves the distractors were built from a belief rather than invented.
        distractorSource: { type: 'string' },
        isTransfer: { type: 'boolean' },
        blocks: blocksProperty,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'prompt', 'rubric', 'isTransfer', 'blocks'],
      properties: {
        type: { type: 'string', enum: ['explain'] },
        prompt: { type: 'string' },
        rubric: { type: 'string' },
        isTransfer: { type: 'boolean' },
        blocks: blocksProperty,
      },
    },
  ],
} as const;

/** One batch: items keyed by concept slug (T-162). */
export const itemsBatchJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['concepts'],
  properties: {
    concepts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['slug', 'items'],
        properties: {
          slug: { type: 'string' },
          items: { type: 'array', items: itemVariants },
        },
      },
    },
  },
} as const satisfies Record<string, unknown>;

export const itemsJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['topic', 'items'],
  properties: {
    topic: { type: 'string' },
    items: {
      type: 'array',
      items: {
        anyOf: [
          textVariant('recall'),
          textVariant('application'),
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'prompt', 'options', 'answerIndex', 'distractorSource', 'isTransfer', 'blocks'],
            properties: {
              type: { type: 'string', enum: ['recognition'] },
              prompt: { type: 'string' },
              options: { type: 'array', items: { type: 'string' } },
              answerIndex: { type: 'integer' },
              distractorSource: { type: 'string' },
              isTransfer: { type: 'boolean' },
              blocks: blocksProperty,
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'prompt', 'rubric', 'isTransfer', 'blocks'],
            properties: {
              type: { type: 'string', enum: ['explain'] },
              prompt: { type: 'string' },
              rubric: { type: 'string' },
              isTransfer: { type: 'boolean' },
              blocks: blocksProperty,
            },
          },
        ],
      },
    },
  },
} as const satisfies Record<string, unknown>;

/**
 * Built per call rather than once at module scope, because the batch checks
 * need the *request* to compare the response against — which slugs were asked
 * for, and therefore which are missing or extra.
 *
 * The alternative was validating after `runPrompt` returned, and that would
 * move every check outside the retry loop: a single over-long rubric in one of
 * ~175 generated items would fail an entire 15-minute topic with no second
 * attempt, which is exactly what putting `validate` inside the loop exists to
 * prevent.
 */
export function itemsBatchPrompt(topic: string, slugs: string[], domain?: string) {
  return definePrompt({
    name: 'items',
    schema: BatchResponseSchema,
    jsonSchema: { name: 'items_response', schema: itemsBatchJsonSchema as unknown as Record<string, unknown> },
    validate: (value) => void validateItemsBatch(value, topic, slugs),
    tolerate: isRepairable,
  });
}

export const itemsPrompt = definePrompt({
  name: 'items',
  schema: RawItemsResponseSchema,
  jsonSchema: { name: 'items_response', schema: itemsJsonSchema as unknown as Record<string, unknown> },
  validate: (value) => void validateItems(value),
  tolerate: isRepairable,
});

/**
 * Context, not just a title (T-FIX-006).
 *
 * This used to be `generateItems(concept.title)`, and a bare concept name is
 * routinely ambiguous: a real generation of "Sliding window" produced a
 * *correct* explanation of the two-pointer array technique for
 * "Variable-size window" and then six questions about TCP flow control, for
 * the same concept. The learner reads about subarrays and is tested on
 * acknowledgement windows — which scores as a failed recall and quietly
 * corrupts the retention measurement.
 *
 * The teaching generator has always had the topic and summary; this is the
 * same context, and the prompt is told explicitly that the topic decides what
 * the concept means.
 */
export interface ItemsInput {
  /** The wider course, e.g. "Sliding window". */
  topic: string;
  /**
   * The concept's domain (T-082), which selects the prompt fragment.
   *
   * Absent — not `'prose'` — for every concept generated before T-082, and the
   * fragment is appended only on an exact `'code'`. "Not prose" would hand a
   * code fragment to every legacy concept in the database.
   */
  domain?: string;
  /** This concept's title, e.g. "Variable-size window". */
  concept: string;
  /** One sentence on what the concept covers, from the concept map. */
  summary: string;
  /**
   * The language the learner chose for this topic (T-091), or absent when they
   * said it doesn't matter and when the topic has no language at all. Absent
   * removes the line from the prompt rather than sending an empty one.
   */
  language?: string;
}

/**
 * Which fragment a concept gets, if any.
 *
 * `code` (T-083) and `systems` (T-108). `math` is designed but unwritten and is
 * deliberately absent — `loadTemplate` treats a missing fragment as a no-op, so
 * naming it here would silently give a maths concept today's generic prompt
 * while the code claimed otherwise. Add the name when the file exists.
 */
const DOMAIN_FRAGMENTS = new Set(['code', 'systems']);

export function domainFragment(domain: string | undefined): string | undefined {
  return domain !== undefined && DOMAIN_FRAGMENTS.has(domain) ? domain : undefined;
}

/** One concept as the batch prompt sees it. */
export interface BatchConcept {
  slug: string;
  title: string;
  summary: string;
  /** From the concept map — the raw material for this concept's distractors. */
  misconceptions: string[];
}

export interface ItemsBatchInput {
  topic: string;
  level: string;
  /** The one situation the whole course is set in; every non-transfer item
   *  goes here rather than inventing a premise per card. */
  spine: string;
  /** Every concept in this batch shares a domain, which is what lets one
   *  `domains/<d>.md` fragment apply to all of them. */
  domain?: string | undefined;
  concepts: BatchConcept[];
  /** Other concepts in the course — for discrimination items, and so this
   *  batch does not wander into what they cover. No items are written for them. */
  neighbours: string;
  /** Prompts already written for earlier batches, so the model can avoid
   *  repeating them or giving their answers away. Empty on the first batch. */
  asked: string;
  language?: string | undefined;
}

export async function generateItemsBatch(input: ItemsBatchInput): Promise<GeneratedItemsBatch> {
  const slugs = input.concepts.map((c) => c.slug);
  const prompt = itemsBatchPrompt(input.topic, slugs, input.domain);

  let response: unknown;
  try {
    response = await runPrompt(
      prompt,
      {
        topic: input.topic,
        level: input.level,
        spine: input.spine,
        concepts: formatBatchConcepts(input.concepts),
        neighbours: input.neighbours,
        asked: input.asked,
        language: input.language ?? '',
      },
      { fragment: domainFragment(input.domain) },
    );
  } catch (error) {
    if (error instanceof GenerationError) throw error;
    if (error instanceof LlmError) throw new GenerationError(error.reason, error.message, error.raw);
    throw new GenerationError('invalid_shape', `item generation failed: ${String(error)}`);
  }

  // Tolerantly, for the reason the other two generators are: `runPrompt` ran
  // these exact checks twice on this exact reply and either passed it or
  // decided the broken rule was not worth the course. The item count moved into
  // `validateItems` (T-164) — checked out here it sat outside the retry, so the
  // one rule nobody could repair was the one about having too little to work
  // with.
  const batch = validateItemsBatch(response, input.topic, slugs, {
    tolerate: true,
    domain: input.domain,
    enforceBlockDomain: true,
  });
  for (const [slug, items] of batch.bySlug) {
    batch.bySlug.set(slug, items.map((item) => shuffleOptions(item)));
  }
  return batch;
}

/** One block per concept: what it is, and the beliefs its distractors are
 *  built from. Indented under the slug so the model can key its reply. */
export function formatBatchConcepts(concepts: BatchConcept[]): string {
  return concepts
    .map((c) =>
      [
        `- slug: ${c.slug}`,
        `  title: ${c.title}`,
        `  summary: ${c.summary}`,
        `  misconceptions:`,
        ...c.misconceptions.map((m) => `    - ${m}`),
      ].join('\n'),
    )
    .join('\n\n');
}

/**
 * One concept, as a batch of one (T-162).
 *
 * Kept because `tests.worker.ts` needs a single replacement question when a
 * held-out concept's only cached item turns out to be `codeEditor`, which the
 * extension popup cannot render. It delegates rather than keeping a second
 * prompt path: two `items/system.md` files would drift, and the rules that
 * matter here — the four types, the transfer count, the rubric limit — are
 * identical whether one concept is being written or four.
 *
 * `misconceptions` is empty on this path, so the distractors are the model's
 * own. That is a real weakening of the distractor rule, and acceptable only
 * because this is a fallback for one substitute question rather than the path
 * a learner's course is built on.
 */
export async function generateItems(input: ItemsInput): Promise<GeneratedItems> {
  const slug = 'concept';
  const batch = await generateItemsBatch({
    topic: input.topic,
    level: 'working',
    spine: input.topic,
    domain: input.domain,
    concepts: [{ slug, title: input.concept, summary: input.summary, misconceptions: [] }],
    neighbours: '',
    asked: '',
    language: input.language,
  });
  return { topic: input.topic, items: batch.bySlug.get(slug) ?? [] };
}

/**
 * Moves the correct answer to a uniformly random position (T-121).
 *
 * **Measured, not suspected.** Across the 369 recognition items in the database
 * the correct option sat at index 1 in 52.3% of them and at index 3 in 1.4% —
 * five items out of 369. Always answering "B" scored 52% without reading the
 * question, and this contaminates the Day-0 and Day-30 tests equally, which is
 * to say it contaminates the measurement the pilot exists to take.
 *
 * Done here rather than in the prompt because position bias is a property of
 * the model, not of the instructions: asking for variety produces slightly
 * different bias, while shuffling produces none. The prompt still carries the
 * one thing a shuffle cannot fix — distractors that match the answer's length
 * and grammatical form.
 */
export function shuffleOptions(item: GeneratedItem, rng: () => number = Math.random): GeneratedItem {
  const payload = item.payload;
  if (payload.type !== 'recognition') return item;

  const answer = payload.options[payload.answerIndex];
  if (answer === undefined) return item;

  const order = payload.options
    .map((option, index) => ({ option, index, key: rng() }))
    .sort((a, b) => a.key - b.key);

  // Located by original index, not by string equality: two options can carry
  // identical text, and matching on text would silently point at the wrong one.
  const answerIndex = order.findIndex((entry) => entry.index === payload.answerIndex);

  return {
    ...item,
    payload: { ...payload, options: order.map((entry) => entry.option), answerIndex },
  };
}

