// The single generation client for the whole backend. Server-only — never
// imported from src/shared (which must stay browser-safe). All generation goes
// through here so model choice, retries and defaults live in one place.
//
// NVIDIA's endpoint is OpenAI-compatible, so the official `openai` SDK talks to
// it directly with a different baseURL. That's also why LangChain isn't here:
// `ChatNVIDIA` wraps this same HTTP API, and plan.md §5 rules out LangChain.
//
// Retries: the SDK already retries 429/5xx/network errors (default maxRetries=2,
// honouring `retry-after`), so we don't hand-roll a limiter for the pilot. Job-
// level retry/backoff is BullMQ's responsibility in the worker (T-007).
import OpenAI from 'openai';
import { env } from '../lib/env.js';
import { LlmError } from './errors.js';

export const DEFAULT_MODEL = 'deepseek-ai/deepseek-v4-pro-0813';

/** Fixed so the same prompt gives the same map twice — makes a bad generation
 *  reproducible while the founder is doing content QA (T-024). */
const SEED = 42;

export const openai = new OpenAI({
  apiKey: env.NVIDIA_API_KEY,
  baseURL: env.NVIDIA_BASE_URL,
});

export interface CompleteOpts {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
}

/** One non-streaming completion. Returns the message content. */
export async function complete(opts: CompleteOpts): Promise<string> {
  // The app boots without a key so `/health` and the frontend work in dev; fail
  // here with something actionable rather than letting the SDK return a bare 401.
  if (!env.NVIDIA_API_KEY) {
    throw new LlmError('missing_api_key', 'NVIDIA_API_KEY is not set — generation cannot run');
  }

  const completion = await openai.chat.completions.create({
    model: opts.model ?? DEFAULT_MODEL,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
    temperature: 1,
    top_p: 0.95,
    max_tokens: opts.maxTokens ?? 8192,
    seed: SEED,
    stream: false,
    // NVIDIA-specific passthrough, absent from OpenAI's types: DeepSeek emits a
    // reasoning block by default, which we'd only have to strip before parsing
    // JSON. Cast is confined to this one call.
    chat_template_kwargs: { thinking: false },
  } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);

  const choice = completion.choices[0];

  // A truncated response is not malformed JSON — it's a too-small token budget,
  // and re-sending the identical request would truncate at exactly the same
  // point. Surface it as its own reason so runPrompt doesn't burn a retry.
  if (choice?.finish_reason === 'length') {
    throw new LlmError(
      'truncated',
      `response hit max_tokens (${opts.maxTokens ?? 8192}) — raise maxTokens for this prompt`,
    );
  }

  return choice?.message?.content ?? '';
}
