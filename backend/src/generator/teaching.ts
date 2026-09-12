import { z } from 'zod';
import { definePrompt, runPrompt, stripFences, LlmError } from '../llm/index.js';
import {
  TeachBlockGenerationSchema,
  TeachBlockSchema,
  optionalOrNull,
  DRAWING_ALT_MAX,
  type TeachBlock,
} from '@learnos/shared';
import type { TeachMode } from '@learnos/shared';
import { GenerationError } from './errors.js';
import { failer, isRepairable, type ValidateOptions } from './severity.js';
import { domainFragment } from './items.js';
import { renderDiagram, renderSequence } from './systemsSvg.js';

/** plan.md §3.5 — a correction list of one is not a list, and past four the
 *  learner is reading a catalogue of ways to be wrong instead of the idea. */
export const MIN_CORRECTIONS = 2;
export const MAX_CORRECTIONS = 4;

export interface GeneratedTeaching {
  tryFirstPrompt: string;
  explanationShort: string;
  explanationLong: string;
  corrections: { wrong: string; why: string }[];
  /** Resolved — `diagram`/`sequence` already carry `svg`, the same as an
   *  item's stored block (T-108). Null for a `prose`/`math` concept (T-145
   *  covers `code` and `systems` only; `math` rides alongside T-109), and
   *  null whenever the fragment itself declined — the gate in
   *  `teaching/domains/*.md` is "does this concept even want one", the same
   *  question the items fragments ask, and "no" is the common answer. */
  teachBlock: TeachBlock | null;
}

// `optionalOrNull`, not `.optional()`: the provider's strict mode requires
// every property in `required`, so an absent block arrives as `null` rather
// than a missing key (T-083's lesson, found twice there — see blocks.ts).
const TeachingResponseSchema = z.object({
  tryFirstPrompt: z.string().trim().min(1),
  explanationShort: z.string().trim().min(1),
  teachBlock: optionalOrNull(TeachBlockGenerationSchema),
  explanationLong: z.string().trim().min(1),
  corrections: z
    .array(z.object({ wrong: z.string().trim().min(1), why: z.string().trim().min(1) }))
    .min(1),
});

export interface TeachingInput {
  /** The wider course, so an ambiguous concept title can be disambiguated. */
  topic: string;
  level: string;
  concept: string;
  summary: string;
  /**
   * Derived from the map's `hardBecause` by `lib/teachMode.ts`, not rolled
   * (T-161). It used to be `rng() < 0.5`, which decided the single most
   * consequential pedagogical choice per concept by coin flip.
   */
  teachMode: TeachMode;
  /** The one situation the course is set in; every example goes here. */
  spine: string;
  /**
   * The map's named misconceptions for this concept, one per line.
   *
   * The same list the item distractors were built from (T-162), which is the
   * point: generated independently, the learner was warned about one mistake
   * and tested on another.
   */
  misconceptions: string;
  /**
   * The items already written for this concept, rendered for reading.
   *
   * Backward design (T-162): the explanation exists to make these answerable
   * three weeks later. They were generated moments earlier in the same loop
   * and then thrown away — the teaching call never saw the questions it was
   * preparing the learner for.
   */
  items: string;
  /** Concepts already taught that this one depends on — named, never
   *  re-explained. Empty for a root concept. */
  prereqs: string;
  /** Concepts later in the course. Naming them here is what stops an
   *  explanation leaning on an idea the learner has no way to look up. */
  notYetTaught: string;
  /** The learner's chosen language (T-091). Absent drops the line entirely —
   *  see `ItemsInput.language`. */
  language?: string;
  /** Selects the prompt fragment (T-145, mirroring T-083's `ItemsInput.domain`
   *  exactly — same `domainFragment()`, same `code`/`systems` set, one place
   *  deciding which domains get one). Only an exact `'code'` or `'systems'`
   *  gets a fragment; `math` and `prose` fall back to the generic prompt. */
  domain?: string;
}

/**
 * Cross-field rules Zod can't express. Kept separate from `generateTeaching` so
 * it is unit-testable without a model call.
 */
/**
 * `diagram`/`sequence` arrive as nodes/edges or lanes/messages, never SVG —
 * the model describes the drawing, the worker draws it (T-108's rule,
 * unchanged here). `code` needs no resolution: there is nothing generated
 * *from* a listing, unlike a diagram's edges.
 */
function resolveTeachBlock(block: z.infer<typeof TeachBlockGenerationSchema> | null): TeachBlock | null {
  if (!block) return null;
  if (block.kind === 'diagram') {
    return TeachBlockSchema.parse({ ...block, svg: renderDiagram(block.nodes, block.edges) });
  }
  if (block.kind === 'sequence') {
    return TeachBlockSchema.parse({ ...block, svg: renderSequence(block.lanes, block.messages) });
  }
  // `code` needs no resolution, but is still re-parsed through the stored
  // schema rather than trusted as-is — the same discipline `seedFormats.ts`
  // uses for items: what the worker is allowed to store is what gets
  // validated immediately before storing it, not assumed from the generation
  // schema having already passed.
  return TeachBlockSchema.parse(block);
}

export function validateTeaching(data: unknown, options: ValidateOptions = {}): GeneratedTeaching {
  const fail = failer('teaching', options.tolerate);
  const parsed = TeachingResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new GenerationError(
      'invalid_shape',
      `invalid teaching content: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
    );
  }
  const result = parsed.data;

  if (result.corrections.length < MIN_CORRECTIONS || result.corrections.length > MAX_CORRECTIONS) {
    fail(
      'corrections_count',
      `got ${result.corrections.length} corrections, need ${MIN_CORRECTIONS}-${MAX_CORRECTIONS}`,
    );
  }

  // The session screen offers "read more" as a distinct affordance (T-021); if
  // the long form isn't actually longer the model has reworded rather than
  // expanded, and the learner taps through to the same text.
  if (result.explanationLong.length <= result.explanationShort.length) {
    fail(
      'explanation_not_expanded',
      'explanationLong must be longer than explanationShort, not a reworded copy',
    );
  }

  return { ...result, teachBlock: resolveTeachBlock(result.teachBlock ?? null) };
}

export function parseTeachingResponse(raw: string): GeneratedTeaching {
  return validateTeaching(JSON.parse(stripFences(raw)));
}

const str = { type: 'string' } as const;
const lang = { type: 'string', enum: [
  'javascript', 'typescript', 'python', 'java', 'go', 'cpp', 'sql', 'bash', 'json', 'plain',
] } as const;
/** Told to the model explicitly (T-158): `alt` had no stated limit anywhere —
 *  not here, not in prose — so nothing signalled that a legitimate, accurate
 *  description of a busier diagram (e.g. two disconnected components) needed
 *  to be compressed. Matches `DRAWING_ALT_MAX` (@learnos/shared). */
const altField = { type: 'string', maxLength: DRAWING_ALT_MAX } as const;

/** The three `teachBlock` kinds, provider-JSON-schema form — deliberately
 *  smaller than `items.ts`'s `blockJsonSchemas`: no `slot`, no answer
 *  surfaces, nothing gradable. Field names mirror `TeachBlockGenerationSchema`
 *  (@learnos/shared) exactly; there is nothing here to keep in step other
 *  than that one file, since neither side computes the other. */
const teachBlockJsonSchema = {
  type: ['object', 'null'],
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'lang', 'src'],
      properties: { kind: { type: 'string', enum: ['code'] }, lang, src: str },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'nodes', 'edges', 'alt'],
      properties: {
        kind: { type: 'string', enum: ['diagram'] },
        nodes: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'label'],
            properties: { id: str, label: str },
          },
        },
        edges: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['from', 'to', 'label'],
            properties: { from: str, to: str, label: { type: ['string', 'null'] } },
          },
        },
        alt: altField,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'lanes', 'messages', 'alt'],
      properties: {
        kind: { type: 'string', enum: ['sequence'] },
        lanes: { type: 'array', items: str },
        messages: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['from', 'to', 'label', 'delayed'],
            properties: {
              from: str,
              to: str,
              label: str,
              delayed: { type: ['boolean', 'null'] },
            },
          },
        },
        alt: altField,
      },
    },
  ],
} as const;

/** Structural contract for the provider (T-FIX-011). The 2–4 correction count
 *  and the short-vs-long length rule stay in `validateTeaching`. */
export const teachingJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['tryFirstPrompt', 'explanationShort', 'explanationLong', 'corrections', 'teachBlock'],
  properties: {
    tryFirstPrompt: { type: 'string' },
    explanationShort: { type: 'string' },
    explanationLong: { type: 'string' },
    corrections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['wrong', 'why'],
        properties: { wrong: { type: 'string' }, why: { type: 'string' } },
      },
    },
    teachBlock: teachBlockJsonSchema,
  },
} as const satisfies Record<string, unknown>;

export const teachingPrompt = definePrompt({
  name: 'teaching',
  schema: TeachingResponseSchema,
  jsonSchema: { name: 'teaching_response', schema: teachingJsonSchema as unknown as Record<string, unknown> },
  validate: (value) => void validateTeaching(value),
  tolerate: isRepairable,
});

/** No outer retry — runPrompt already retries once (see generateConceptMap). */
export async function generateTeaching(input: TeachingInput): Promise<GeneratedTeaching> {
  let response: unknown;
  try {
    response = await runPrompt(
      teachingPrompt,
      {
        topic: input.topic,
        level: input.level,
        concept: input.concept,
        summary: input.summary,
        teachMode: input.teachMode,
        spine: input.spine,
        misconceptions: input.misconceptions,
        items: input.items,
        prereqs: input.prereqs,
        notYetTaught: input.notYetTaught,
        // Empty, not omitted: the template's optional section decides whether
        // the line appears, and `render` throws on a var it was never given.
        language: input.language ?? '',
      },
      // `domain` is not a var at all — it selects a file (T-145, same rule
      // items.ts already follows).
      { fragment: domainFragment(input.domain) },
    );
  } catch (error) {
    // A GenerationError already carries the rule it broke — re-wrapping it
    // would flatten every domain reason into `invalid_shape`.
    if (error instanceof GenerationError) throw error;
    if (error instanceof LlmError) throw new GenerationError(error.reason, error.message, error.raw);
    throw new GenerationError('invalid_shape', `teaching generation failed: ${String(error)}`);
  }

  // Tolerantly, because `runPrompt` already ran this exact check twice on this
  // exact reply: either it passed, in which case tolerance changes nothing, or
  // it was accepted as a preference violation, in which case re-throwing here
  // would undo that decision. Integrity rules still throw either way.
  return validateTeaching(response, { tolerate: true });
}
