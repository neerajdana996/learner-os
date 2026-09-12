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
  | 'refused'
  | 'missing_api_key'
  // concept map
  | 'duplicate_slug'
  | 'unknown_prereq'
  | 'cycle'
  | 'too_few_concepts'
  // concept map — backward design and graph shape (T-161). Each names a
  // different fix, which is why they are not one `invalid_shape`: an unserved
  // capability means a concept is missing, an unknown one means a typo, and a
  // chain that is too deep means the map has to be restructured.
  | 'crux_count'
  | 'unknown_crux'
  | 'thin_crux'
  | 'too_many_prereqs'
  | 'chain_too_deep'
  | 'too_few_roots'
  | 'unknown_capability'
  | 'capability_unserved'
  // items
  | 'missing_item_type'
  | 'transfer_count'
  | 'explain_rubric'
  | 'too_few_items'
  /** The prompt points at a diagram, listing or history the item does not
   *  carry — unanswerable, and it makes every other question look unreliable. */
  | 'dangling_reference'
  | 'too_many_rich'
  // items, batched (T-162). A batch is generated for several neighbouring
  // concepts at once precisely so the model can tell them apart, so "it came
  // back for the wrong set" and "it wrote the same question twice" are the
  // failures worth naming separately from a generic shape complaint.
  | 'batch_slug_mismatch'
  | 'duplicate_prompt'
  | 'item_cues_another'
  // teaching. Both were `invalid_shape`, which put them in the same bucket as
  // "this could not be stored" and so made them un-classifiable by severity
  // (T-164): a concept that came back with one correction is a thinner lesson,
  // not an unusable one.
  | 'corrections_count'
  | 'explanation_not_expanded'
  // the control arm (T-165)
  /** Fewer held-out concepts than the floor, because too few were eligible. */
  | 'thin_control_arm'
  /** A taught lesson names a concept the learner is never taught. */
  | 'held_out_leak';

export class GenerationError extends Error {
  constructor(
    public readonly reason: GenerationErrorReason,
    message: string,
    /** The raw model response, when this wraps an `LlmError` (T-157) — without
     *  it, an `invalid_shape` failure names only the rule that was broken,
     *  never what the model actually sent, so every failure had to be paid
     *  for twice: once to fail, once more to reproduce it with logging added. */
    public readonly raw?: string,
  ) {
    super(`${reason}: ${message}`);
    this.name = 'GenerationError';
  }
}
