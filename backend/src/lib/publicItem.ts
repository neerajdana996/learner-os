import { ItemPayloadSchema, type PublicItem } from '../shared/index.js';

/**
 * The one place an item crosses from server to client.
 *
 * It builds the client shape field by field rather than deleting keys from the
 * payload, so a new answer-bearing field added to `ItemPayload` later is
 * excluded by default instead of leaking until someone remembers to strip it.
 * `answer`, `accept`, `answerIndex` and `rubric` never leave the server —
 * grading happens in T-011 (plan.md §6, T-010, T-033).
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
  };

  // Options are the only answer-adjacent field a client legitimately needs:
  // you can't render a multiple choice question without them. `answerIndex`
  // stays behind.
  return payload.type === 'recognition' ? { ...base, options: payload.options } : base;
}
