// The single Anthropic client for the whole backend. Server-only — never
// imported from src/shared (which must stay browser-safe). All generation goes
// through here so model choice, retries and defaults live in one place.
//
// Retries: the SDK already retries 429/5xx/network errors (default maxRetries=2,
// honouring `retry-after`), so we don't hand-roll a limiter for the pilot. Job-
// level retry/backoff is BullMQ's responsibility in the worker (T-007).
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../lib/env.js';
import { LlmError } from './errors.js';

// Default generation model (plan.md §5 pinned claude-sonnet-4-6; upgraded to
// current-gen sonnet-5 for better maps/items → less content-QA fixing).
// Per-prompt overrides live on each PromptDef.model.
export const DEFAULT_MODEL = 'claude-sonnet-5';

export const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

export interface CompleteOpts {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
}

/** One non-streaming completion. Returns the concatenated text blocks. */
export async function complete(opts: CompleteOpts): Promise<string> {
  // The app boots without a key so `/health` and the frontend work in dev; fail
  // here with something actionable rather than letting the SDK return a bare 401.
  if (!env.ANTHROPIC_API_KEY) {
    throw new LlmError('missing_api_key', 'ANTHROPIC_API_KEY is not set — generation cannot run');
  }

  const msg = await anthropic.messages.create({
    // Note: SDK 0.52.0 has no structured-outputs (output_config) or `effort`.
    // When the SDK is upgraded, prefer output_config.format + a JSON schema
    // over the strip-fences→Zod path in index.ts.
    model: opts.model ?? DEFAULT_MODEL,
    max_tokens: opts.maxTokens ?? 8192,
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
  });

  // A truncated response is not malformed JSON — it's a too-small token budget,
  // and re-sending the identical request would truncate at exactly the same
  // point. Surface it as its own reason so runPrompt doesn't burn a retry.
  if (msg.stop_reason === 'max_tokens') {
    throw new LlmError(
      'truncated',
      `response hit max_tokens (${opts.maxTokens ?? 8192}) — raise maxTokens for this prompt`,
    );
  }

  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}
