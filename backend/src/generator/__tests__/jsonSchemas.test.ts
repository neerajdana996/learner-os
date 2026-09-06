import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const create = vi.fn();
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create } };
  },
}));

const { itemsJsonSchema, itemsPrompt, blockJsonSchemas } = await import('../items.js');
const { conceptMapJsonSchema, ConceptMapSchema, conceptMapPrompt } = await import('../conceptMap.js');
const { teachingJsonSchema, teachingPrompt } = await import('../teaching.js');
const { ItemGenerationSchema, BlockGenerationSchema } = await import('@learnos/shared');

type JsonSchema = {
  /** An array when the node is nullable — strict mode's way of saying optional. */
  type?: string | string[];
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
  // A nullable node's `type` is `['array', 'null']` rather than `'array'`
  // (T-083). Before this, such a node was skipped entirely — and every block
  // schema hangs off one, so the whole union went unchecked.
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.includes('array') && schema.items) {
    assertStrict(schema.items, `${path}[]`);
    return;
  }
  if (!types.includes('object')) return;

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

  // Pinned against ItemGenerationSchema, not ItemPayloadSchema (T-080): this
  // JSON schema is the contract for what the *model* emits, and after the split
  // those are two different shapes. `.innerType()` unwraps the superRefine.
  const generationVariants = () =>
    (ItemGenerationSchema.innerType() as unknown as { options: z.ZodTypeAny[] }).options;

  it('every ItemGeneration variant has a matching JSON schema variant', () => {
    const variants = generationVariants();
    const jsonVariants = (itemsJsonSchema as unknown as JsonSchema).properties?.items?.items?.anyOf ?? [];

    expect(jsonVariants).toHaveLength(variants.length);

    for (const variant of variants) {
      // isTransfer is a sibling column on the items table, not part of the
      // jsonb payload, so the model must emit it but the payload schema does
      // not declare it — hence the explicit addition here.
      const expected = [...zodKeys(variant), 'isTransfer'].sort();
      const match = jsonVariants.find((v) => [...(v.required ?? [])].sort().join() === expected.join());
      expect(match, `no JSON variant matches Zod keys ${expected.join(',')}`).toBeDefined();
    }
  });

  /**
   * The provider contract and the Zod generation schema must agree about
   * `blocks`, in both directions.
   *
   * Strict mode sets `additionalProperties: false`, so **the model cannot emit
   * a field this JSON schema omits** — which is why `domains/code.md` on its
   * own would have been completely inert. T-080 left this false deliberately
   * and T-083 flipped it, in the same change as the fragment.
   */
  it('offers blocks to the provider, on every item variant', () => {
    const jsonVariants = (itemsJsonSchema as unknown as JsonSchema).properties?.items?.items?.anyOf ?? [];
    expect(generationVariants().every((v) => zodKeys(v).includes('blocks'))).toBe(true);
    expect(jsonVariants.every((v) => 'blocks' in (v.properties ?? {}))).toBe(true);
    // Optional is expressed as a nullable type, never by omission: strict mode
    // requires the key in `required` regardless.
    for (const variant of jsonVariants) {
      expect(variant.required).toContain('blocks');
      expect(variant.properties?.blocks?.type).toEqual(['array', 'null']);
    }
  });

  it('every block kind the Zod union accepts is on offer, with the same keys', () => {
    const zodBlocks = (
      (BlockGenerationSchema.innerType() as unknown as { options: z.ZodTypeAny[] }).options
    );
    const jsonBlocks = [...blockJsonSchemas] as unknown as JsonSchema[];

    expect(jsonBlocks).toHaveLength(zodBlocks.length);
    for (const variant of zodBlocks) {
      const expected = zodKeys(variant);
      const match = jsonBlocks.find((v) => [...(v.required ?? [])].sort().join() === expected.join());
      expect(match, `no JSON block matches Zod keys ${expected.join(',')}`).toBeDefined();
    }
  });

  it('never offers the model a line number — only quotes', () => {
    // The failure this prevents is silent: a wrong line number stores fine and
    // a learner sees an annotation pointing at the wrong line on day six.
    //
    // Scoped to the variants that carry a listing. `diagram.edges` and
    // `sequence.messages` also use `from`/`to`, but those name a node or a lane
    // and a dangling one is dropped when the drawing is rendered (T-108) — a
    // visible absence, not a silently wrong annotation. Matching the whole blob
    // would fail on those and say nothing about line numbers.
    const listings = blockJsonSchemas.filter((v) => 'src' in ((v as JsonSchema).properties ?? {}));
    expect(listings.length).toBeGreaterThan(0);
    expect(JSON.stringify(listings)).not.toMatch(/"(line|from|to)":/);
    expect(JSON.stringify(blockJsonSchemas)).toContain('lineQuote');
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
