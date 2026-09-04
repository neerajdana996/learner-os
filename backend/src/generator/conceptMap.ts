import { z } from 'zod';
import { definePrompt, runPrompt, stripFences } from '../llm/index.js';

export class GenerationError extends Error {
  constructor(public readonly reason: 'unknown_prereq' | 'cycle' | 'invalid_json' | 'invalid_shape', message: string) {
    super(`${reason}: ${message}`);
    this.name = 'GenerationError';
  }
}

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

export function parseConceptMapResponse(raw: string) {
  const json = JSON.parse(stripFences(raw));
  return ConceptMapSchema.parse(json);
}

export function validateConceptMap(data: unknown): z.infer<typeof ConceptMapSchema> {
  const parsed = ConceptMapSchema.parse(data);
  const seen = new Set(parsed.concepts.map((concept) => concept.slug));
  for (const concept of parsed.concepts) {
    for (const prereq of concept.prereqs) {
      if (!seen.has(prereq)) {
        throw new GenerationError('unknown_prereq', `concept ${concept.slug} references missing prereq ${prereq}`);
      }
    }
  }

  const visited = new Set<string>();
  const stack = new Set<string>();
  const visit = (slug: string): void => {
    if (stack.has(slug)) throw new GenerationError('cycle', `cycle detected involving ${slug}`);
    if (visited.has(slug)) return;
    stack.add(slug);
    const concept = parsed.concepts.find((item) => item.slug === slug);
    if (!concept) return;
    for (const prereq of concept.prereqs) visit(prereq);
    stack.delete(slug);
    visited.add(slug);
  };

  for (const concept of parsed.concepts) visit(concept.slug);
  return parsed;
}

export const conceptMapPrompt = definePrompt({
  name: 'conceptMap',
  schema: ConceptMapSchema,
});

export async function generateConceptMap(topic: string) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await runPrompt(conceptMapPrompt, { topic });
      return validateConceptMap(response);
    } catch (error) {
      lastError = error;
      if (attempt === 0) continue;
    }
  }

  if (lastError instanceof GenerationError) throw lastError;
  if (lastError instanceof Error) {
    throw new GenerationError('invalid_shape', `concept map generation failed: ${lastError.message}`);
  }
  throw new GenerationError('invalid_shape', 'concept map generation failed');
}
