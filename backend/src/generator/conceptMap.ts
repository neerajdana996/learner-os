import { z } from 'zod';
import { definePrompt, runPrompt, stripFences, LlmError } from '../llm/index.js';
import { ConceptDomainSchema, type ConceptDomain } from '@learnos/shared';
import { formatCapabilities, formatList, formatSpine, type Framing } from './framing.js';

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
import { failer, isRepairable } from './severity.js';

export { GenerationError, type GenerationErrorReason };

/**
 * Why a concept is hard — a decision, not a comment (T-161).
 *
 * This replaces the coin flip that used to choose `teachMode`
 * (`rng() < 0.5 ? 'try_first' : 'example_first'` in generator.worker.ts). Those
 * two modes are opposite prescriptions: attempting before being told works when
 * the learner has enough adjacent knowledge to produce a meaningful wrong
 * answer, and is just frustration when they have no foothold at all — where a
 * worked example wins instead. Choosing at random guaranteed the wrong mode on
 * roughly half of every map.
 *
 * The model reports the *observation* (what would happen if you put this in
 * front of the learner cold); `lib/teachMode.ts` turns it into the mode. Keeping
 * those separate means the policy is inspectable and changeable without
 * regenerating anyone's course.
 */
export const ConceptHardnessSchema = z.enum([
  'no-prior-hook',
  'counterintuitive',
  'confusable-neighbour',
  'many-moving-parts',
  'not-hard',
]);
export type ConceptHardness = z.infer<typeof ConceptHardnessSchema>;

/** Below this a "crux" concept is not one — if two distinct wrong beliefs
 *  cannot be named about it, it is not where learners get stuck. */
const CRUX_MIN_MISCONCEPTIONS = 2;
export const MIN_CRUX = 2;
export const MAX_CRUX = 4;
/** Shape limits, all for the same reason: a learner misses days. A 16-concept
 *  map that is one long chain is a valid DAG and an unrecoverable course. */
export const MAX_PREREQS_PER_CONCEPT = 3;
export const MAX_CHAIN_LENGTH = 5;
export const MIN_ROOTS = 3;

const ConceptSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  prereqs: z.array(z.string()).default([]),
  /**
   * Which capabilities (by `Framing` id) this concept exists to serve. Both
   * halves of the backward-design test read this: a capability nothing serves
   * is a promise the course cannot keep, and a concept serving nothing is
   * interesting and irrelevant — the rule that stops a 16-concept map becoming
   * a 30-concept one.
   */
  serves: z.array(z.string().min(1)).min(1),
  /**
   * The specific wrong belief a learner holds, in their own voice. Load-bearing
   * downstream: item distractors are built from these and teaching corrections
   * address them, so the two halves of the course finally agree instead of
   * independently inventing what people get wrong.
   */
  misconceptions: z.array(z.string().trim().min(1).max(300)).min(1).max(2),
  hardBecause: ConceptHardnessSchema,
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
  /**
   * The 2–4 threshold concepts: the ones that reorganise understanding and
   * where people predictably get stuck. Capped on purpose — a boolean per
   * concept invites marking nine of sixteen as important, and a ranking is what
   * this needs to be.
   *
   * Two things read it. Held-out selection must never pick one (it is random
   * today, so a crux concept can be silently removed from a learner's course,
   * and the day-30 comparison then measures nothing interesting), and review
   * weighting should favour them.
   */
  crux: z.array(z.string().min(1)),
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
export interface ConceptMapCheckOptions {
  /**
   * Capability ids from the framing call. Omitted, the backward-design checks
   * are skipped — `validateConceptMap` stays callable from unit tests and from
   * `seed.ts`, which read a fixture with no framing beside it.
   */
  capabilityIds?: string[];
  /** Downgrade the shape preferences — root count, chain depth, prereq count,
   *  crux size, unserved capability — to warnings (T-164). */
  tolerate?: boolean;
}

export function validateConceptMap(data: unknown, options: ConceptMapCheckOptions = {}): ConceptMap {
  const fail = failer('conceptMap', options.tolerate);
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

  // ---- graph shape (T-161) ----
  // Validity is not enough: all three of these are legal DAGs that make an
  // unteachable course once a learner misses a day.
  for (const concept of parsed.concepts) {
    if (concept.prereqs.length > MAX_PREREQS_PER_CONCEPT) {
      fail(
        'too_many_prereqs',
        `concept ${concept.slug} has ${concept.prereqs.length} prereqs, max ${MAX_PREREQS_PER_CONCEPT} — ` +
          'a concept needing more than that is a summary of the ones before it, not an atomic idea',
      );
    }
  }

  const roots = parsed.concepts.filter((concept) => concept.prereqs.length === 0);
  if (roots.length < MIN_ROOTS) {
    fail(
      'too_few_roots',
      `got ${roots.length} concepts with no prerequisites, need at least ${MIN_ROOTS} — ` +
        'fewer means there are not enough independent threads to teach from on a given day',
    );
  }

  // Safe to memoise without a cycle guard: the visit above already proved the
  // graph is acyclic.
  const depths = new Map<string, number>();
  const depthOf = (slug: string): number => {
    const cached = depths.get(slug);
    if (cached !== undefined) return cached;
    const prereqs = bySlug.get(slug)?.prereqs ?? [];
    const depth = prereqs.length === 0 ? 1 : 1 + Math.max(...prereqs.map(depthOf));
    depths.set(slug, depth);
    return depth;
  };
  for (const concept of parsed.concepts) {
    const depth = depthOf(concept.slug);
    if (depth > MAX_CHAIN_LENGTH) {
      fail(
        'chain_too_deep',
        `the chain ending at ${concept.slug} is ${depth} concepts long, max ${MAX_CHAIN_LENGTH} — ` +
          'a long chain means one missed day blocks everything after it',
      );
    }
  }

  // ---- crux ----
  if (parsed.crux.length < MIN_CRUX || parsed.crux.length > MAX_CRUX) {
    fail(
      'crux_count',
      `got ${parsed.crux.length} crux concepts, need ${MIN_CRUX}-${MAX_CRUX} — ` +
        'this is a ranking of what is load-bearing, not a label for what is important',
    );
  }
  for (const slug of parsed.crux) {
    const concept = bySlug.get(slug);
    if (!concept) {
      throw new GenerationError('unknown_crux', `crux references missing concept ${slug}`);
    }
    if (concept.misconceptions.length < CRUX_MIN_MISCONCEPTIONS) {
      fail(
        'thin_crux',
        `crux concept ${slug} names ${concept.misconceptions.length} misconception(s), need ` +
          `${CRUX_MIN_MISCONCEPTIONS} — if two distinct wrong beliefs cannot be named about it, ` +
          'it is not where learners get stuck',
      );
    }
  }

  // ---- backward design ----
  // Only when the capability list is available; see ConceptMapCheckOptions.
  if (options.capabilityIds) {
    const known = new Set(options.capabilityIds);
    for (const concept of parsed.concepts) {
      for (const id of concept.serves) {
        if (!known.has(id)) {
          throw new GenerationError(
            'unknown_capability',
            `concept ${concept.slug} serves unknown capability ${id}`,
          );
        }
      }
    }

    const served = new Set(parsed.concepts.flatMap((concept) => concept.serves));
    for (const id of options.capabilityIds) {
      if (!served.has(id)) {
        fail(
          'capability_unserved',
          `no concept serves capability ${id} — the course promises something it never teaches`,
        );
      }
    }
  }

  return parsed;
}

/** Structural contract for the provider (T-FIX-011). Counts and DAG validity
 *  are not expressible here — they stay in `validateConceptMap`. */
export const conceptMapJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['topic', 'crux', 'concepts'],
  properties: {
    topic: { type: 'string' },
    crux: { type: 'array', items: { type: 'string' } },
    concepts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['slug', 'title', 'summary', 'prereqs', 'serves', 'domain', 'hardBecause', 'misconceptions'],
        properties: {
          slug: { type: 'string' },
          title: { type: 'string' },
          summary: { type: 'string' },
          prereqs: { type: 'array', items: { type: 'string' } },
          serves: { type: 'array', items: { type: 'string' } },
          // Enumerated for the provider as well as for Zod: under strict mode
          // this makes an invented value like "javascript" structurally
          // impossible rather than a retry.
          domain: { type: 'string', enum: [...ConceptDomainSchema.options] },
          hardBecause: { type: 'string', enum: [...ConceptHardnessSchema.options] },
          misconceptions: { type: 'array', items: { type: 'string' } },
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
  tolerate: isRepairable,
});

/**
 * runPrompt already retries once on malformed/mis-shaped JSON, so there is no
 * outer retry here — wrapping it in another loop would cost 4 model calls per
 * failure instead of the 2 the task specifies. Graph violations are terminal:
 * they mean the model produced a coherent but invalid map, and the job should
 * fail loudly with a typed reason (plan.md §5).
 */
export async function generateConceptMap(
  framing: Framing,
  language?: string | undefined,
): Promise<ConceptMap> {
  const capabilityIds = framing.capabilities.map((c) => c.id);

  // `unknown` because ConceptMapSchema's input type differs from its output
  // (prereqs has a default); validateConceptMap re-parses into the output type.
  let response: unknown;
  try {
    response = await runPrompt(conceptMapPrompt, {
      topic: framing.topic,
      level: framing.level,
      capabilities: formatCapabilities(framing.capabilities),
      centralMisconception: framing.centralMisconception,
      spine: formatSpine(framing.spine),
      assumedKnowledge: formatList(framing.assumedKnowledge),
      outOfScope: formatList(framing.outOfScope),
      language: language ?? '',
    });
  } catch (error) {
    // A GenerationError already carries the rule it broke — re-wrapping it
    // would flatten every domain reason into `invalid_shape`.
    if (error instanceof GenerationError) throw error;
    if (error instanceof LlmError) throw new GenerationError(error.reason, error.message, error.raw);
    throw new GenerationError('invalid_shape', `concept map generation failed: ${String(error)}`);
  }

  const topic = framing.topic;
  // Tolerantly: `runPrompt` already ran the graph checks twice on this reply.
  // The capability checks run only here (the retry hook has no framing), so a
  // `capability_unserved` warning is reported for the first time at this point
  // — and `unknown_capability`, which means a concept points at an id that does
  // not exist, still throws.
  const map = validateConceptMap(response, { capabilityIds, tolerate: true });
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
