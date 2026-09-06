import { z } from 'zod';
import { definePrompt, runPrompt, stripFences, LlmError } from '../llm/index.js';
import type { TeachMode } from '../shared/index.js';
import { GenerationError } from './errors.js';

/** plan.md §3.5 — a correction list of one is not a list, and past four the
 *  learner is reading a catalogue of ways to be wrong instead of the idea. */
export const MIN_CORRECTIONS = 2;
export const MAX_CORRECTIONS = 4;

export interface GeneratedTeaching {
  tryFirstPrompt: string;
  explanationShort: string;
  explanationLong: string;
  corrections: { wrong: string; why: string }[];
}

const TeachingResponseSchema = z.object({
  tryFirstPrompt: z.string().trim().min(1),
  explanationShort: z.string().trim().min(1),
  explanationLong: z.string().trim().min(1),
  corrections: z
    .array(z.object({ wrong: z.string().trim().min(1), why: z.string().trim().min(1) }))
    .min(1),
});

export interface TeachingInput {
  /** The wider course, so an ambiguous concept title can be disambiguated. */
  topic: string;
  concept: string;
  summary: string;
  teachMode: TeachMode;
  /** The learner's chosen language (T-091). Absent drops the line entirely —
   *  see `ItemsInput.language`. */
  language?: string;
}

/**
 * Cross-field rules Zod can't express. Kept separate from `generateTeaching` so
 * it is unit-testable without a model call.
 */
export function validateTeaching(data: unknown): GeneratedTeaching {
  const parsed = TeachingResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new GenerationError(
      'invalid_shape',
      `invalid teaching content: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
    );
  }
  const result = parsed.data;

  if (result.corrections.length < MIN_CORRECTIONS || result.corrections.length > MAX_CORRECTIONS) {
    throw new GenerationError(
      'invalid_shape',
      `got ${result.corrections.length} corrections, need ${MIN_CORRECTIONS}-${MAX_CORRECTIONS}`,
    );
  }

  // The session screen offers "read more" as a distinct affordance (T-021); if
  // the long form isn't actually longer the model has reworded rather than
  // expanded, and the learner taps through to the same text.
  if (result.explanationLong.length <= result.explanationShort.length) {
    throw new GenerationError(
      'invalid_shape',
      'explanationLong must be longer than explanationShort, not a reworded copy',
    );
  }

  return result;
}

export function parseTeachingResponse(raw: string): GeneratedTeaching {
  return validateTeaching(JSON.parse(stripFences(raw)));
}

/** Structural contract for the provider (T-FIX-011). The 2–4 correction count
 *  and the short-vs-long length rule stay in `validateTeaching`. */
export const teachingJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['tryFirstPrompt', 'explanationShort', 'explanationLong', 'corrections'],
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
  },
} as const satisfies Record<string, unknown>;

export const teachingPrompt = definePrompt({
  name: 'teaching',
  schema: TeachingResponseSchema,
  jsonSchema: { name: 'teaching_response', schema: teachingJsonSchema as unknown as Record<string, unknown> },
  validate: (value) => void validateTeaching(value),
});

/** No outer retry — runPrompt already retries once (see generateConceptMap). */
export async function generateTeaching(input: TeachingInput): Promise<GeneratedTeaching> {
  let response: unknown;
  try {
    response = await runPrompt(teachingPrompt, {
      topic: input.topic,
      concept: input.concept,
      summary: input.summary,
      teachMode: input.teachMode,
      // Empty, not omitted: the template's optional section decides whether the
      // line appears, and `render` throws on a var it was never given.
      language: input.language ?? '',
    });
  } catch (error) {
    // A GenerationError already carries the rule it broke — re-wrapping it
    // would flatten every domain reason into `invalid_shape`.
    if (error instanceof GenerationError) throw error;
    if (error instanceof LlmError) throw new GenerationError(error.reason, error.message);
    throw new GenerationError('invalid_shape', `teaching generation failed: ${String(error)}`);
  }

  return validateTeaching(response);
}
