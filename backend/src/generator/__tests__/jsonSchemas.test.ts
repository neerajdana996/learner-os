import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const create = vi.fn();
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create } };
  },
}));

const { itemsJsonSchema, itemsPrompt } = await import('../items.js');
const { conceptMapJsonSchema, ConceptMapSchema, conceptMapPrompt } = await import('../conceptMap.js');
const { teachingJsonSchema, teachingPrompt } = await import('../teaching.js');
const { ItemPayloadSchema } = await import('../../shared/index.js');

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
};

/**
 * OpenAI strict mode rejects a schema unless every object sets
 * `additionalProperties: false` and lists *all* of its properties in
 * `required`. A violation is a 400 at generation time, i.e. in production
 * rather than here — so it is worth asserting structurally.
 */
function assertStrict(schema: JsonSchema, path = 'root'): void {
  if (schema.anyOf) {
    schema.anyOf.forEach((variant, i) => assertStrict(variant, `${path}.anyOf[${i}]`));
    return;
  }
  if (schema.type === 'array' && schema.items) {
    assertStrict(schema.items, `${path}[]`);
    return;
  }
  if (schema.type !== 'object') return;

  expect(schema.additionalProperties, `${path}: additionalProperties must be false`).toBe(false);

  const properties = Object.keys(schema.properties ?? {});
  expect([...(schema.required ?? [])].sort(), `${path}: every property must be required`).toEqual(
    [...properties].sort(),
  );

  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    assertStrict(child, `${path}.${key}`);
  }
}

/** Keys a Zod object schema declares, for drift comparison. */
function zodKeys(schema: z.ZodTypeAny): string[] {
  return Object.keys((schema as unknown as { shape: Record<string, unknown> }).shape).sort();
}

describe('provider JSON schemas satisfy strict mode', () => {
  it('concept map', () => assertStrict(conceptMapJsonSchema as unknown as JsonSchema));
  it('items', () => assertStrict(itemsJsonSchema as unknown as JsonSchema));
  it('teaching', () => assertStrict(teachingJsonSchema as unknown as JsonSchema));
});

describe('JSON schemas do not drift from the Zod schemas', () => {
  it('concept map top level and concept shape match', () => {
    expect([...(conceptMapJsonSchema.required as unknown as string[])].sort()).toEqual(zodKeys(ConceptMapSchema));

    const conceptZod = (ConceptMapSchema.shape.concepts as unknown as { element: z.ZodTypeAny }).element;
    const conceptJson = (conceptMapJsonSchema as unknown as JsonSchema).properties?.concepts?.items;
    expect([...(conceptJson?.required ?? [])].sort()).toEqual(zodKeys(conceptZod));
  });

  it('every ItemPayload variant has a matching JSON schema variant', () => {
    const variants = (ItemPayloadSchema as unknown as { options: z.ZodTypeAny[] }).options;
    const jsonVariants = (itemsJsonSchema as unknown as JsonSchema).properties?.items?.items?.anyOf ?? [];

    expect(jsonVariants).toHaveLength(variants.length);

    for (const variant of variants) {
      // isTransfer is a sibling column on the items table, not part of the
      // jsonb payload, so the model must emit it but ItemPayloadSchema does not
      // declare it — hence the explicit addition here.
      const expected = [...zodKeys(variant), 'isTransfer'].sort();
      const match = jsonVariants.find((v) => [...(v.required ?? [])].sort().join() === expected.join());
      expect(match, `no JSON variant matches Zod keys ${expected.join(',')}`).toBeDefined();
    }
  });

  it('every item variant requires isTransfer — the field that broke real generation', () => {
    const jsonVariants = (itemsJsonSchema as unknown as JsonSchema).properties?.items?.items?.anyOf ?? [];
    expect(jsonVariants.length).toBeGreaterThan(0);
    for (const variant of jsonVariants) {
      expect(variant.required).toContain('isTransfer');
    }
  });
});

describe('runPrompt sends the schema to the provider', () => {
  const asText = (text: string) => ({ choices: [{ message: { content: text }, finish_reason: 'stop' }] });

  it.each([
    ['items', itemsPrompt, 'items_response'],
    ['conceptMap', conceptMapPrompt, 'concept_map_response'],
    ['teaching', teachingPrompt, 'teaching_response'],
  ])('%s', async (_name, prompt, schemaName) => {
    create.mockReset();
    create.mockResolvedValue(asText('{"not":"valid"}'));

    const { runPrompt } = await import('../../llm/index.js');
    // Every var the three templates between them reference. `language` is
    // supplied empty rather than omitted: it is an *optional value*, not an
    // optional var, and `render` throws on a var it was never given — the same
    // loud failure a renamed `{{concept}}` gets (T-091).
    await runPrompt(prompt as never, {
      topic: 'x',
      concept: 'y',
      summary: 'z',
      teachMode: 'try_first',
      language: '',
    } as never).catch(() => undefined);

    const sent = create.mock.calls[0]?.[0];
    expect(sent?.response_format?.type).toBe('json_schema');
    expect(sent?.response_format?.json_schema?.name).toBe(schemaName);
    // Without strict:true the schema is a hint the model may ignore, which is
    // exactly the failure this fixes.
    expect(sent?.response_format?.json_schema?.strict).toBe(true);
  });
});

describe('domain validation is retried, not fatal on first offence', () => {
  const asText = (text: string) => ({ choices: [{ message: { content: text }, finish_reason: 'stop' }] });

  /** Six items, all four types, one transfer — valid unless a rule is broken. */
  const itemSet = (rubric: string) => ({
    topic: 'useState',
    items: [
      { type: 'recall', prompt: 'q', answer: 'a', accept: [], isTransfer: false },
      { type: 'recognition', prompt: 'q', options: ['a', 'b', 'c', 'd'], answerIndex: 0, isTransfer: false },
      { type: 'application', prompt: 'q', answer: 'a', accept: [], isTransfer: true },
      { type: 'explain', prompt: 'q', rubric, isTransfer: false },
      { type: 'recall', prompt: 'q2', answer: 'a', accept: [], isTransfer: false },
      { type: 'recall', prompt: 'q3', answer: 'a', accept: [], isTransfer: false },
    ],
  });

  it('retries once when a rubric is over length, then succeeds', async () => {
    create.mockReset();
    create
      .mockResolvedValueOnce(asText(JSON.stringify(itemSet('x'.repeat(250)))))
      .mockResolvedValueOnce(asText(JSON.stringify(itemSet('short rubric'))));

    const { generateItems } = await import('../items.js');
    await expect(generateItems({ topic: 'useState', concept: 'useState', summary: 'what it covers' })).resolves.toMatchObject({ topic: 'useState' });
    // One over-long rubric used to fail an entire 15-minute topic outright.
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('reports the domain rule by name when both attempts break it', async () => {
    create.mockReset();
    create.mockResolvedValue(asText(JSON.stringify(itemSet('x'.repeat(250)))));

    const { generateItems } = await import('../items.js');
    await expect(generateItems({ topic: 'useState', concept: 'useState', summary: 'what it covers' })).rejects.toThrow(/rubric/);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
