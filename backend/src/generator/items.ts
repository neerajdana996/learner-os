import { z } from 'zod';
import { definePrompt, runPrompt, stripFences, LlmError } from '../llm/index.js';
import { ItemPayloadSchema, LangSchema, BlockSlotSchema, type ItemPayload } from '@learnos/shared';
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
 * unit tested with small sets; the 6-item floor lives in generateItems.
 */
export function validateItems(data: unknown): GeneratedItems {
  const { topic, items: rawItems } = RawItemsResponseSchema.parse(data);
  const items = rawItems.map(parseGeneratedItem);

  const types = new Set(items.map((item) => item.payload.type));
  if (!types.has('recall') || !types.has('recognition') || !types.has('application') || !types.has('explain')) {
    throw new GenerationError('missing_item_type', 'all four item types are required');
  }

  const transferCount = items.filter((item) => item.isTransfer).length;
  if (transferCount === 0) {
    throw new GenerationError('transfer_count', 'at least one item must be marked as transfer');
  }
  if (transferCount > 2) {
    throw new GenerationError('transfer_count', 'no more than 2 transfer items allowed');
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
    throw new GenerationError(
      'too_many_rich',
      `${rich} items use a rich answer format; at most ${MAX_RICH_ITEMS} per concept`,
    );
  }

  return { topic, items };
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
    alt: str,
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
    alt: str,
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
            required: ['type', 'prompt', 'options', 'answerIndex', 'isTransfer', 'blocks'],
            properties: {
              type: { type: 'string', enum: ['recognition'] },
              prompt: { type: 'string' },
              options: { type: 'array', items: { type: 'string' } },
              answerIndex: { type: 'integer' },
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

export const itemsPrompt = definePrompt({
  name: 'items',
  schema: RawItemsResponseSchema,
  jsonSchema: { name: 'items_response', schema: itemsJsonSchema as unknown as Record<string, unknown> },
  // Inside the retry loop: a single over-long rubric should cost one more call,
  // not the whole topic.
  validate: (value) => void validateItems(value),
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

/** No outer retry — runPrompt already retries once (see generateConceptMap). */
export async function generateItems(input: ItemsInput): Promise<GeneratedItems> {
  let response: unknown;
  try {
    // `language: ''` rather than omitted: the template's optional section is
    // what decides whether the line appears, and `render` throws on a var it
    // was never given. `domain` is not a var at all — it selects a file.
    const { domain, ...vars } = input;
    response = await runPrompt(
      itemsPrompt,
      { ...vars, language: input.language ?? '' },
      { fragment: domainFragment(domain) },
    );
  } catch (error) {
    // A GenerationError already carries the rule it broke — re-wrapping it
    // would flatten every domain reason into `invalid_shape`.
    if (error instanceof GenerationError) throw error;
    if (error instanceof LlmError) throw new GenerationError(error.reason, error.message);
    throw new GenerationError('invalid_shape', `item generation failed: ${String(error)}`);
  }

  const result = validateItems(response);
  if (result.items.length < MIN_ITEMS) {
    throw new GenerationError('too_few_items', `got ${result.items.length} items, need at least ${MIN_ITEMS}`);
  }
  return { ...result, items: result.items.map((item) => shuffleOptions(item)) };
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

