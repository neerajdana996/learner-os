import { z } from 'zod';
import { definePrompt, runPrompt, stripFences, LlmError } from '../llm/index.js';
import { ItemPayloadSchema, type ItemPayload } from '../shared/index.js';

/** sprint.md's Sprint 1 demo expects 6–8 items per taught concept. */
export const MIN_ITEMS = 6;

export type GenerationErrorReason =
  | 'invalid_json'
  | 'invalid_shape'
  | 'truncated'
  | 'missing_api_key'
  | 'missing_item_type'
  | 'transfer_count'
  | 'explain_rubric'
  | 'too_few_items';

export class GenerationError extends Error {
  constructor(
    public readonly reason: GenerationErrorReason,
    message: string,
  ) {
    super(`${reason}: ${message}`);
    this.name = 'GenerationError';
  }
}

export interface GeneratedItem {
  payload: ItemPayload;
  isTransfer: boolean;
}

export interface GeneratedItems {
  topic: string;
  items: GeneratedItem[];
}

const RawItemsResponseSchema = z.object({
  topic: z.string().min(1),
  items: z.array(z.unknown()).min(1),
});

/**
 * Validates one raw item against the shared ItemPayload shape (loop.md: never
 * redefine a shared schema) and pulls out `isTransfer`, which lives alongside
 * `payload` on the `items` table row, not inside the jsonb payload itself.
 */
function parseGeneratedItem(raw: unknown): GeneratedItem {
  const result = ItemPayloadSchema.safeParse(raw);
  if (!result.success) {
    const type = (raw as { type?: unknown } | null)?.type;
    const label = typeof type === 'string' ? type : 'item';
    throw new GenerationError(
      'invalid_shape',
      `invalid ${label} payload: ${result.error.issues.map((i) => i.message).join('; ')}`,
    );
  }
  const isTransfer = (raw as { isTransfer?: unknown } | null)?.isTransfer;
  if (typeof isTransfer !== 'boolean') {
    throw new GenerationError('invalid_shape', `${result.data.type} item is missing a boolean isTransfer flag`);
  }
  return { payload: result.data, isTransfer };
}

export function parseItemsResponse(raw: string): GeneratedItems {
  return validateItems(JSON.parse(stripFences(raw)));
}

/**
 * Per-item shape + the cross-item rules. Size-agnostic on purpose so it can be
 * unit tested with small sets; the 6-item floor lives in generateItems.
 */
export function validateItems(data: unknown): GeneratedItems {
  const { topic, items: rawItems } = RawItemsResponseSchema.parse(data);
  const items = rawItems.map(parseGeneratedItem);

  const types = new Set(items.map((item) => item.payload.type));
  if (!types.has('recall') || !types.has('recognition') || !types.has('application') || !types.has('explain')) {
    throw new GenerationError('missing_item_type', 'all four item types are required');
  }

  const transferCount = items.filter((item) => item.isTransfer).length;
  if (transferCount === 0) {
    throw new GenerationError('transfer_count', 'at least one item must be marked as transfer');
  }
  if (transferCount > 2) {
    throw new GenerationError('transfer_count', 'no more than 2 transfer items allowed');
  }

  for (const item of items) {
    if (item.payload.type === 'explain' && item.payload.rubric.length > 200) {
      throw new GenerationError('explain_rubric', 'explain rubric must be 200 characters or less');
    }
  }

  return { topic, items };
}

export const itemsPrompt = definePrompt({
  name: 'items',
  schema: RawItemsResponseSchema,
});

/** No outer retry — runPrompt already retries once (see generateConceptMap). */
export async function generateItems(topic: string): Promise<GeneratedItems> {
  let response: unknown;
  try {
    response = await runPrompt(itemsPrompt, { topic });
  } catch (error) {
    if (error instanceof LlmError) throw new GenerationError(error.reason, error.message);
    throw new GenerationError('invalid_shape', `item generation failed: ${String(error)}`);
  }

  const result = validateItems(response);
  if (result.items.length < MIN_ITEMS) {
    throw new GenerationError('too_few_items', `got ${result.items.length} items, need at least ${MIN_ITEMS}`);
  }
  return result;
}
