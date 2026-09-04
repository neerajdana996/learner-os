// Lives in its own module so client.ts can throw it without importing index.ts
// (which imports client.ts).

export type LlmErrorReason =
  | 'invalid_json'
  | 'invalid_shape'
  /** Response hit max_tokens — retrying the same request would truncate again. */
  | 'truncated'
  | 'missing_api_key';

export class LlmError extends Error {
  constructor(
    public readonly reason: LlmErrorReason,
    message: string,
    public readonly raw?: string,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}
