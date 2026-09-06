import { ItemPayloadSchema, toPublicBlocks, type PublicItem } from '@learnos/shared';

/**
 * The one place an item crosses from server to client.
 *
 * It builds the client shape field by field rather than deleting keys from the
 * payload, so a new answer-bearing field added to `ItemPayload` later is
 * excluded by default instead of leaking until someone remembers to strip it.
 * `answer`, `accept`, `answerIndex` and `rubric` never leave the server —
 * grading happens in T-011 (plan.md §6, T-010, T-033). Blocks go through
 * `toPublicBlocks`, which strips each block's answer key the same way and drops
 * every `reveal` block outright — a reveal block *is* the answer (T-080).
 *
 * Throws if the stored payload doesn't match `ItemPayloadSchema`: a
 * malformed row should fail loudly, not be served as a broken question.
 */
export function toPublicItem(row: { id: string; conceptId: string; payload: unknown }): PublicItem {
  const payload = ItemPayloadSchema.parse(row.payload);

  const base = {
    itemId: row.id,
    conceptId: row.conceptId,
    type: payload.type,
    prompt: payload.prompt,
    // Absent, not empty: an item without blocks renders from `prompt` exactly
    // as it did before T-080, on every surface.
    ...(payload.blocks ? { blocks: toPublicBlocks(payload.blocks) } : {}),
  };

  // Options are the only answer-adjacent field a client legitimately needs:
  // you can't render a multiple choice question without them. `answerIndex`
  // stays behind.
  return payload.type === 'recognition' ? { ...base, options: payload.options } : base;
}
