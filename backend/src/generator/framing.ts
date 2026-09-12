import { z } from 'zod';
import { definePrompt, runPrompt, stripFences, LlmError } from '../llm/index.js';
import { GenerationError } from './errors.js';

/**
 * Phase 0 — scoping, before any content exists (T-161).
 *
 * The pipeline used to start at `generateConceptMap(topic.title)`: a single
 * string. Everything the learner told us about *why* they wanted the topic was
 * collected in onboarding, written to `topics.why`, and then never read by any
 * generator — so "I keep failing system design interviews" and "our replication
 * lag is paging me at 3am" produced an identical course.
 *
 * This call turns the title plus that reason into the specification the rest of
 * the pipeline is built from: what the learner will be able to *do*, the belief
 * the course exists to dismantle, and the one situation every later example is
 * set in. Its output is an input to every downstream call — the map, the items
 * and the teaching — which is what makes the course cohere instead of being
 * sixteen independently invented scenarios.
 */

/** How the course is pitched. Chosen from the learner's own reason, not from
 *  the topic: the same title is three different courses at these three levels. */
export const CourseLevelSchema = z.enum(['intro', 'working', 'deep']);
export type CourseLevel = z.infer<typeof CourseLevelSchema>;

/** Lowercase-hyphenated, because concepts reference these ids in `serves` and a
 *  reference that differs by case is a reference that silently matches nothing. */
const CAPABILITY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const CapabilitySchema = z.object({
  id: z.string().regex(CAPABILITY_ID, 'capability id must be lowercase-hyphenated'),
  /** A *doing* statement. "Understands X" is not one — nothing downstream can
   *  be built to prove it, which is the whole point of backward design. */
  statement: z.string().trim().min(1).max(200),
  /** What a correct demonstration looks like, concretely enough that the item
   *  generator can aim at it. */
  evidence: z.string().trim().min(1).max(300),
});

export type Capability = z.infer<typeof CapabilitySchema>;

const SpineSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(600),
  /** Must name a capability it serves. A spine chosen because it sounded good
   *  is one that fights the content for seven days. */
  whyItFits: z.string().trim().min(1).max(400),
});

export const FramingSchema = z.object({
  topic: z.string().trim().min(1),
  level: CourseLevelSchema,
  capabilities: z.array(CapabilitySchema).min(3).max(5),
  /** Stated as the learner would say it, in their own voice — the next phase
   *  builds distractors from it, and it can only do that from a belief. */
  centralMisconception: z.string().trim().min(1).max(300),
  spine: SpineSchema,
  assumedKnowledge: z.array(z.string().trim().min(1).max(200)).min(2).max(4),
  outOfScope: z.array(z.string().trim().min(1).max(300)).min(2).max(4),
});

export type Framing = z.infer<typeof FramingSchema>;

export function parseFramingResponse(raw: string): Framing {
  return validateFraming(JSON.parse(stripFences(raw)));
}

/**
 * Rules the JSON schema cannot express. Kept size-agnostic where possible so
 * this is unit-testable with small fixtures.
 */
export function validateFraming(data: unknown): Framing {
  const parsed = FramingSchema.parse(data);

  const seen = new Set<string>();
  for (const capability of parsed.capabilities) {
    if (seen.has(capability.id)) {
      throw new GenerationError('duplicate_slug', `capability id ${capability.id} appears more than once`);
    }
    seen.add(capability.id);
  }

  return parsed;
}

/** Structural contract for the provider. Counts and uniqueness stay in Zod and
 *  `validateFraming` — strict mode ignores most of them. */
export const framingJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'topic',
    'level',
    'capabilities',
    'centralMisconception',
    'spine',
    'assumedKnowledge',
    'outOfScope',
  ],
  properties: {
    topic: { type: 'string' },
    level: { type: 'string', enum: [...CourseLevelSchema.options] },
    capabilities: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'statement', 'evidence'],
        properties: { id: { type: 'string' }, statement: { type: 'string' }, evidence: { type: 'string' } },
      },
    },
    centralMisconception: { type: 'string' },
    spine: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'description', 'whyItFits'],
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        whyItFits: { type: 'string' },
      },
    },
    assumedKnowledge: { type: 'array', items: { type: 'string' } },
    outOfScope: { type: 'array', items: { type: 'string' } },
  },
} as const satisfies Record<string, unknown>;

export const framingPrompt = definePrompt({
  name: 'framing',
  schema: FramingSchema,
  jsonSchema: { name: 'framing_response', schema: framingJsonSchema as unknown as Record<string, unknown> },
  validate: (value) => void validateFraming(value),
});

export interface FramingInput {
  topic: string;
  /** The learner's own words from onboarding. Absent is handled — the prompt
   *  falls back to `working`, the level that fails most gracefully either way. */
  why?: string | undefined;
  language?: string | undefined;
}

export async function generateFraming(input: FramingInput): Promise<Framing> {
  try {
    return await runPrompt(framingPrompt, {
      topic: input.topic,
      // Empty, not omitted: the template's optional sections decide whether the
      // line appears, and `render` throws on a var it was never given.
      why: input.why ?? '',
      language: input.language ?? '',
    });
  } catch (error) {
    if (error instanceof GenerationError) throw error;
    if (error instanceof LlmError) throw new GenerationError(error.reason, error.message, error.raw);
    throw new GenerationError('invalid_shape', `framing generation failed: ${String(error)}`);
  }
}

/** Renders the capability list for the map prompt's `{{capabilities}}` var.
 *  One line each, id first, because the map has to reference them by id. */
export function formatCapabilities(capabilities: Capability[]): string {
  return capabilities.map((c) => `- ${c.id}: ${c.statement}\n  Evidence: ${c.evidence}`).join('\n');
}

export function formatSpine(spine: Framing['spine']): string {
  return `${spine.name} — ${spine.description}`;
}

/** Bullet list for `{{assumedKnowledge}}` / `{{outOfScope}}`. */
export function formatList(items: string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}
