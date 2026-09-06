import { z } from 'zod';
import { definePrompt, runPrompt, stripFences, LlmError } from '../llm/index.js';
import { ConceptDomainSchema, type ConceptDomain } from '@learnos/shared';

/**
 * Floor on a usable map. Below this the course is unusable — the diagnostic,
 * the session planner and the ~10% held-out selection all degrade — so the job
 * fails loudly instead of enrolling someone in a 3-concept "course".
 *
 * **The gap between this and the prompt's 14–16 is deliberate** (T-FIX-006).
 * The prompt asks for the size a course actually needs; this is the line below
 * which something is *broken*, and sprint.md's Sprint 1 demo expects 10–40, so
 * raising it would fail that demo. A map that lands in between is thin rather
 * than broken, so it warns instead of failing — the founder sees it during
 * content QA (T-024) and can regenerate.
 */
export const MIN_CONCEPTS = 10;
/** What the prompt asks for. A map below this is thin, not broken. */
export const EXPECTED_MIN_CONCEPTS = 14;
/**
 * Above this the map cannot be finished in the time available, which is the
 * failure T-104 introduced the risk of: `MAX_NEW_CONCEPTS` is 3 a day and a
 * course runs 7 days, so 21 is the hard ceiling. A map that overruns leaves
 * concepts untaught, and untaught concepts make the day-30 comparison
 * unreadable — the pilot's entire output.
 */
export const MAX_TEACHABLE_CONCEPTS = 21;

import { GenerationError, type GenerationErrorReason } from './errors.js';

export { GenerationError, type GenerationErrorReason };

const ConceptSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  prereqs: z.array(z.string()).default([]),
  /**
   * Decided here and not in the item pass (T-082): this call already reasons
   * about what each concept *is* in order to order and link them, so asking
   * forty separate item calls to re-derive it would pay for the same judgement
   * forty times, on the cheap model, with no guarantee two siblings agree.
   *
   * Required, with no default. A default would be a silent claim about every
   * concept the model declined to classify, and `domain` is what decides which
   * question formats a concept can even use (T-083).
   */
  domain: ConceptDomainSchema,
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
        required: ['slug', 'title', 'summary', 'prereqs', 'domain'],
        properties: {
          slug: { type: 'string' },
          title: { type: 'string' },
          summary: { type: 'string' },
          prereqs: { type: 'array', items: { type: 'string' } },
          // Enumerated for the provider as well as for Zod: under strict mode
          // this makes an invented value like "javascript" structurally
          // impossible rather than a retry.
          domain: { type: 'string', enum: [...ConceptDomainSchema.options] },
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
        `${EXPECTED_MIN_CONCEPTS}–16. Thin for a 7-day course — worth regenerating before QA.`,
    );
  }
  if (map.concepts.length > MAX_TEACHABLE_CONCEPTS) {
    console.warn(
      `concept map for "${topic}" has ${map.concepts.length} concepts; at 3 new a day a 7-day ` +
        `course can teach ${MAX_TEACHABLE_CONCEPTS}. The tail would never be taught, and untaught ` +
        `concepts make the day-30 comparison unreadable — regenerate before QA.`,
    );
  }
  warnOnUniformDomain(topic, map);
  return map;
}

/**
 * A map where every concept has the same domain is legal and almost always
 * wrong (T-082).
 *
 * It is the signature of a model that classified by *subject* — every concept
 * in a topic called "Dynamic programming" coming back `code` — and it silently
 * disables every format decision downstream: `domains/code.md` gets appended to
 * all forty item calls, and the concepts whose correct answer is a sentence get
 * a blank cut into a listing instead.
 *
 * Not a hard failure, because a genuinely uniform topic does exist. A warning
 * plus a line in `docs/qa-checklist.md` is enough: the founder reads every
 * topic before anyone is onboarded onto it, and this is one glance.
 */
export function domainSplit(map: ConceptMap): Record<ConceptDomain, number> {
  const split = { code: 0, math: 0, systems: 0, prose: 0 };
  for (const concept of map.concepts) split[concept.domain] += 1;
  return split;
}

function warnOnUniformDomain(topic: string, map: ConceptMap): void {
  const split = domainSplit(map);
  const used = Object.entries(split).filter(([, n]) => n > 0);
  if (used.length > 1 || map.concepts.length < 2) return;

  const [only] = used as [[ConceptDomain, number]];
  console.warn(
    `concept map for "${topic}": all ${map.concepts.length} concepts are "${only[0]}". ` +
      'Legal, but usually means the model classified by subject rather than by what a correct ' +
      'answer looks like — check the domain split before onboarding anyone (docs/qa-checklist.md).',
  );
}
