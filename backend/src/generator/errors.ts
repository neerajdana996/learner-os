/**
 * The one `GenerationError` for every generator.
 *
 * `conceptMap.ts` and `items.ts` each used to declare their own class of this
 * name. Two classes with one name means `instanceof` succeeds or fails
 * depending purely on which module the catching code imported from — a caller
 * handling a concept-map failure would not recognise an items failure. Both now
 * re-export this, so existing imports keep working and the check is sound.
 */
export type GenerationErrorReason =
  // shared with the LLM layer (LlmError reasons pass straight through)
  | 'invalid_json'
  | 'invalid_shape'
  | 'truncated'
  | 'missing_api_key'
  // concept map
  | 'duplicate_slug'
  | 'unknown_prereq'
  | 'cycle'
  | 'too_few_concepts'
  // items
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
