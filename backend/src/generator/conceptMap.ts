import { z } from 'zod';
import { definePrompt, runPrompt, stripFences, LlmError } from '../llm/index.js';

/**
 * Floor on a usable map. Below this the course is unusable — the diagnostic,
 * the session planner and the ~10% held-out selection all degrade — so the job
 * fails loudly instead of enrolling someone in a 3-concept "course".
 *
 * **The gap between this and the prompt's 20–40 is deliberate** (T-FIX-006).
 * The prompt asks for the size a 30-day course actually needs; this is the line
 * below which something is *broken*, and sprint.md's Sprint 1 demo expects
 * 10–40, so raising it would fail that demo. A map that lands in between is
 * thin rather than broken, so it warns instead of failing — the founder sees it
 * during content QA (T-024) and can regenerate.
 */
export const MIN_CONCEPTS = 10;
/** What the prompt asks for. A map below this is thin, not broken. */
export const EXPECTED_MIN_CONCEPTS = 20;

import { GenerationError, type GenerationErrorReason } from './errors.js';

export { GenerationError, type GenerationErrorReason };

const ConceptSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  prereqs: z.array(z.string()).default([]),
});

export const ConceptMapSchema = z.object({
  topic: z.string().min(1),
  concepts: z.array(ConceptSchema).min(1),
});

export type ConceptMap = z.infer<typeof ConceptMapSchema>;

export function parseConceptMapResponse(raw: string): ConceptMap {
  return validateConceptMap(JSON.parse(stripFences(raw)));
}

/**
 * Structural + graph invariants. Size-agnostic on purpose so it can be unit
 * tested with tiny maps; the "is this map big enough to teach" gate lives in
 * generateConceptMap.
 */
export function validateConceptMap(data: unknown): ConceptMap {
  const parsed = ConceptMapSchema.parse(data);

  // Duplicate slugs would survive the prereq check below (a Set collapses them)
  // and only blow up at persist time against concepts(topic_id, slug) unique.
  const seen = new Set<string>();
  for (const concept of parsed.concepts) {
    if (seen.has(concept.slug)) {
      throw new GenerationError('duplicate_slug', `slug ${concept.slug} appears more than once`);
    }
    seen.add(concept.slug);
  }

  for (const concept of parsed.concepts) {
    for (const prereq of concept.prereqs) {
      if (!seen.has(prereq)) {
        throw new GenerationError('unknown_prereq', `concept ${concept.slug} references missing prereq ${prereq}`);
      }
    }
  }

  const bySlug = new Map(parsed.concepts.map((concept) => [concept.slug, concept]));
  const visited = new Set<string>();
  const stack = new Set<string>();
  const visit = (slug: string): void => {
    if (stack.has(slug)) throw new GenerationError('cycle', `cycle detected involving ${slug}`);
    if (visited.has(slug)) return;
    stack.add(slug);
    for (const prereq of bySlug.get(slug)?.prereqs ?? []) visit(prereq);
    stack.delete(slug);
    visited.add(slug);
  };

  for (const concept of parsed.concepts) visit(concept.slug);
  return parsed;
}

/** Structural contract for the provider (T-FIX-011). Counts and DAG validity
 *  are not expressible here — they stay in `validateConceptMap`. */
export const conceptMapJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['topic', 'concepts'],
  properties: {
    topic: { type: 'string' },
    concepts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['slug', 'title', 'summary', 'prereqs'],
        properties: {
          slug: { type: 'string' },
          title: { type: 'string' },
          summary: { type: 'string' },
          prereqs: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const satisfies Record<string, unknown>;

export const conceptMapPrompt = definePrompt({
  name: 'conceptMap',
  schema: ConceptMapSchema,
  jsonSchema: {
    name: 'concept_map_response',
    schema: conceptMapJsonSchema as unknown as Record<string, unknown>,
  },
  validate: (value) => void validateConceptMap(value),
});

/**
 * runPrompt already retries once on malformed/mis-shaped JSON, so there is no
 * outer retry here — wrapping it in another loop would cost 4 model calls per
 * failure instead of the 2 the task specifies. Graph violations are terminal:
 * they mean the model produced a coherent but invalid map, and the job should
 * fail loudly with a typed reason (plan.md §5).
 */
export async function generateConceptMap(topic: string): Promise<ConceptMap> {
  // `unknown` because ConceptMapSchema's input type differs from its output
  // (prereqs has a default); validateConceptMap re-parses into the output type.
  let response: unknown;
  try {
    response = await runPrompt(conceptMapPrompt, { topic });
  } catch (error) {
    // A GenerationError already carries the rule it broke — re-wrapping it
    // would flatten every domain reason into `invalid_shape`.
    if (error instanceof GenerationError) throw error;
    if (error instanceof LlmError) throw new GenerationError(error.reason, error.message);
    throw new GenerationError('invalid_shape', `concept map generation failed: ${String(error)}`);
  }

  const map = validateConceptMap(response);
  if (map.concepts.length < MIN_CONCEPTS) {
    throw new GenerationError(
      'too_few_concepts',
      `got ${map.concepts.length} concepts, need at least ${MIN_CONCEPTS}`,
    );
  }
  if (map.concepts.length < EXPECTED_MIN_CONCEPTS) {
    console.warn(
      `concept map for "${topic}" has ${map.concepts.length} concepts; the prompt asks for ` +
        `${EXPECTED_MIN_CONCEPTS}–40. Thin for a 30-day course — worth regenerating before QA.`,
    );
  }
  return map;
}
