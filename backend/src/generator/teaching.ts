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

/** `domain` decides whether a `teachBlock` was authorised at all — it is the
 *  same value that selects the prompt fragment, so the check and the
 *  instruction cannot disagree (T-167). */
interface TeachingValidateOptions extends ValidateOptions {
  domain?: string | undefined;
  /**
   * Run the domain check at all. Off inside `runPrompt`'s retry hook, which has
   * no domain to judge against and must not re-ask the model over decoration:
   * six `prose` concepts in a sixteen-concept topic would each buy a second
   * call to be told the same thing. The remedy is to drop the block, and
   * dropping happens once, on the way out.
   */
  enforceBlockDomain?: boolean;
}
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
  // Accepted as anything here and parsed on its own in `validateTeaching`.
  // Parsed as part of the whole reply, one bad block failed the lesson — and
  // with it the course: run 5 died after ~20 successful calls because one
  // diagram edge label was 25 characters against a 24-character limit.
  teachBlock: z.unknown(),
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

/**
 * The block, parsed apart from the lesson it decorates.
 *
 * A malformed block is dropped rather than failing the reply. The provider's
 * strict JSON schema guarantees the block's *structure* but not its string
 * limits, so a label one character too long reaches Zod — and before this, Zod
 * rejected the whole reply as `invalid_shape`, which is fatal and runs before
 * T-164's severity split ever gets a say. The repair turn did not save it
 * either: the retry was told the label was too long and wrote another one.
 *
 * Checked only on the outer call, the same as the domain check below it and
 * for the same reason — inside `runPrompt`'s retry hook a bad block is treated
 * as absent, so it cannot buy a second model call over decoration.
 */
function parseTeachBlock(
  raw: unknown,
  options: TeachingValidateOptions,
  fail: ReturnType<typeof failer>,
): TeachBlock | null {
  if (raw === null || raw === undefined) return null;

  let problem: string | null = null;
  let block: TeachBlock | null = null;
  const parsed = TeachBlockGenerationSchema.safeParse(raw);
  if (!parsed.success) {
    problem = parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ');
  } else {
    // Resolution renders SVG and re-parses against the stored schema, and
    // either can reject a block the generation schema accepted.
    try {
      block = resolveTeachBlock(parsed.data);
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
  }

  if (problem === null) return block;
  if (options.enforceBlockDomain) fail('block_malformed', `teachBlock dropped: ${problem}`);
  return null;
}

export function validateTeaching(data: unknown, options: TeachingValidateOptions = {}): GeneratedTeaching {
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

  /**
   * A block is kept only where a domain section authorised one (T-167).
   *
   * Rule 5 of `teaching/system.md` is explicit — *"Without that section, always
   * `null` — do not invent one for a `prose` concept because the idea could be
   * drawn"* — and nothing enforced it: all 13 taught concepts of the first real
   * generation came back with a block, 12 of kind `code`, including six `prose`
   * concepts whose prompt never loaded a fragment at all.
   *
   * Dropped rather than rejected, and reported rather than dropped silently.
   * Rejecting would end a nineteen-call generation over decoration on one
   * lesson, which is exactly what T-164 exists to prevent; keeping it would
   * leave the prompts describing one thing and the database holding another.
   *
   * **If the rule is what is wrong, this is the line to change**: the blocks in
   * that generation looked like illustration rather than decoration, and a
   * Python snippet beside a prose concept may well be worth having. That is a
   * content decision, so it is written down rather than made here.
   */
  const block = parseTeachBlock(result.teachBlock, options, fail);
  if (options.enforceBlockDomain && block && domainFragment(options.domain) === undefined) {
    fail(
      'block_without_domain',
      `a ${block.kind} teachBlock was written for a concept with no domain section (domain: ${options.domain ?? 'none'})`,
    );
    return { ...result, teachBlock: null };
  }

  return { ...result, teachBlock: block };
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
  return validateTeaching(response, { tolerate: true, domain: input.domain, enforceBlockDomain: true });
}
