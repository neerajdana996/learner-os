// The single generation client for the whole backend. Server-only — never
// imported from src/shared (which must stay browser-safe). All generation goes
// through here so model choice, retries and defaults live in one place.
//
// Every provider we target speaks the OpenAI chat-completions shape, so the
// official `openai` SDK covers all of them and switching is a base-URL change
// (T-052). That is also why LangChain isn't here — plan.md §5 rules it out and
// it would only wrap this same HTTP API.
//
// Retries: the SDK already retries 429/5xx/network errors (default maxRetries=2,
// honouring `retry-after`), so we don't hand-roll a limiter for the pilot. Job-
// level retry/backoff is BullMQ's responsibility in the worker (T-007).
import OpenAI from 'openai';
import { env } from '../lib/env.js';
import { LlmError } from './errors.js';
import { DEFAULT_MODEL, DEFAULT_REASONING_EFFORT, type ReasoningEffort } from './models.js';

export { DEFAULT_MODEL } from './models.js';

/**
 * Built on first use, not at import.
 *
 * The OpenAI SDK throws from its constructor when no key is present, so
 * constructing at module load took the whole process down at boot — `/health`
 * included — for anyone without a key. That contradicts the deliberate choice
 * in T-FIX-001 to fail at job time with an actionable message instead of at
 * boot, and it breaks `scripts/verify.sh`, which must pass with no key set.
 */
let client: OpenAI | null = null;

export function getClient(): OpenAI {
  client ??= new OpenAI({ apiKey: env.OPENAI_API_KEY, baseURL: env.LLM_BASE_URL });
  return client;
}

export interface CompleteOpts {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
  reasoningEffort?: ReasoningEffort;
  /**
   * When supplied, the provider guarantees the reply matches this JSON schema.
   * That removes malformed JSON as a failure mode entirely, which is what makes
   * the cheap tier safe on the constrained prompts.
   */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
}

/** One non-streaming completion. Returns the message content. */
export async function complete(opts: CompleteOpts): Promise<string> {
  // The app boots without a key so `/health` and the frontend work in dev; fail
  // here with something actionable rather than letting the SDK return a bare 401.
  if (!env.OPENAI_API_KEY) {
    throw new LlmError('missing_api_key', 'OPENAI_API_KEY is not set — generation cannot run');
  }

  const maxTokens = opts.maxTokens ?? 8192;

  const completion = await getClient().chat.completions.create({
    model: opts.model ?? DEFAULT_MODEL,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
    // Must be explicit: gpt-5.6 defaults to `medium` when omitted, so leaving
    // it off silently buys reasoning latency and tokens on every call.
    reasoning_effort: opts.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
    max_completion_tokens: maxTokens,
    stream: false,
    ...(opts.jsonSchema
      ? {
          response_format: {
            type: 'json_schema',
            json_schema: { name: opts.jsonSchema.name, schema: opts.jsonSchema.schema, strict: true },
          },
        }
      : {}),
  } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);

  const choice = completion.choices[0];

  // A truncated response is not malformed JSON — it's a too-small token budget,
  // and re-sending the identical request would truncate at exactly the same
  // point. Surface it as its own reason so runPrompt doesn't burn a retry.
  if (choice?.finish_reason === 'length') {
    throw new LlmError(
      'truncated',
      `response hit max_completion_tokens (${maxTokens}) — raise maxTokens for this prompt`,
    );
  }

  // A refusal is not a parse failure and retrying it changes nothing.
  const refusal = (choice?.message as { refusal?: string } | undefined)?.refusal;
  if (refusal) throw new LlmError('refused', `model refused: ${refusal}`);

  return choice?.message?.content ?? '';
}
