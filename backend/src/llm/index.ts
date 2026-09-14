// Public entry point for the LLM module. A "prompt" is a typed unit: its input
// vars, its .md templates (loaded by name), and the Zod schema its JSON output
// must satisfy. `runPrompt(def, vars)` renders → calls the model → strips
// fences → JSON.parse → Zod-validates, retrying once on malformed output.
//
// Server-only. Never import from src/shared.
import type { ZodType } from 'zod';
import { complete } from './client.js';
import { loadTemplate, render } from './prompts.js';
import { LlmError } from './errors.js';
import { MODELS, DEFAULT_MODEL, DEFAULT_REASONING_EFFORT, type ReasoningEffort } from './models.js';

export { MODELS, DEFAULT_MODEL, type ReasoningEffort } from './models.js';
export { getClient, complete } from './client.js';
export { loadTemplate, render } from './prompts.js';
export { LlmError, type LlmErrorReason } from './errors.js';

/**
 * A registered prompt. `name` locates the .md folder; `Vars` is the render
 * input; `Out` is the validated result type (inferred from `schema`). Build one
 * with `definePrompt` so both ends stay type-safe.
 */
export interface PromptDef<Vars extends Record<string, string>, Out> {
  name: string;
  schema: ZodType<Out>;
  /** Overrides the MODELS entry for this prompt name; rarely needed. */
  model?: string;
  reasoningEffort?: ReasoningEffort;
  maxTokens?: number;
  /**
   * JSON Schema handed to the provider so the reply is structurally guaranteed.
   *
   * This covers *presence and shape* — a required field cannot be dropped.
   * Constraints the provider ignores under strict mode (exact array lengths,
   * string limits, cross-field rules) stay in the Zod schema and the domain
   * validators, so the two layers are complementary rather than duplicated.
   */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  /**
   * Per-attempt HTTP timeout and SDK retry count, for prompts in a request path.
   *
   * The SDK defaults — ten minutes, two retries — suit a generation worker and
   * are wrong for a learner waiting on a verdict: a stuck call would hold their
   * answer for half an hour. Omitted, the SDK defaults apply (T-171).
   */
  timeoutMs?: number;
  maxRetries?: number;
  /**
   * Domain rules the schema cannot express — exact array lengths, string
   * limits, cross-item counts. Throw to reject the response.
   *
   * It runs *inside* the retry loop deliberately. Left outside, a single soft
   * violation in one of ~175 generated items failed an entire 15-minute topic
   * with no second attempt, while a malformed brace got two. Same class of
   * failure, same treatment.
   */
  validate?: (value: Out) => void;
  /**
   * Whether a `validate` failure that survived the repair attempt should be
   * accepted rather than thrown (T-164).
   *
   * The policy belongs to the generator, not here: this layer knows a rule was
   * broken, only the domain knows whether the rule was "this item cannot be
   * answered" or "this concept got five questions instead of six". Returning
   * true hands the reply back unchanged — the caller is then responsible for
   * re-validating tolerantly and reporting the warning.
   */
  tolerate?: (error: unknown) => boolean;
  /** Marker for the Vars type; never read at runtime. */
  readonly _vars?: Vars;
}

export function definePrompt<Vars extends Record<string, string>, Out>(
  def: Omit<PromptDef<Vars, Out>, '_vars'>,
): PromptDef<Vars, Out> {
  return def;
}

/**
 * Pulls the first ```-fenced block's contents if present (handles ```json), else
 * returns the trimmed input. Models sometimes wrap JSON in prose or fences.
 */
export function stripFences(text: string): string {
  const fence = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
  return (fence?.[1] ?? text).trim();
}

export interface RunOptions {
  /**
   * Appends `prompts/<name>/domains/<fragment>.md` to the system prompt for
   * this call only (T-083).
   *
   * It goes **last**, after the generic example, because it is the most
   * specific instruction and it carries its own worked example — a code
   * example landing before a generic one reads as the exception rather than
   * the rule. A fragment that does not exist is a no-op, so a `math` concept
   * gets today's prompt until `math.md` is written.
   */
  fragment?: string;
}

export async function runPrompt<Vars extends Record<string, string>, Out>(
  def: PromptDef<Vars, Out>,
  vars: Vars,
  options: RunOptions = {},
): Promise<Out> {
  const tpl = loadTemplate(def.name, options.fragment);
  const withExample = tpl.example ? `${tpl.system}\n\n## Example\n${tpl.example}` : tpl.system;
  const system = tpl.fragment ? `${withExample}\n\n${tpl.fragment}` : withExample;
  const user = render(tpl.user, vars);

  // Per-prompt tier from MODELS, overridable on the definition. Effort is always
  // sent explicitly: gpt-5.6 defaults to `medium` when it is omitted, which
  // would buy reasoning latency on every call including trivial grading.
  const tier = MODELS[def.name as keyof typeof MODELS] as
    | { model: string; reasoningEffort: ReasoningEffort }
    | undefined;
  const model = def.model ?? tier?.model ?? DEFAULT_MODEL;
  const reasoningEffort = def.reasoningEffort ?? tier?.reasoningEffort ?? DEFAULT_REASONING_EFFORT;

  let lastRaw = '';
  let lastDomainError: unknown = null;
  /** The most recent reply that satisfied the schema but broke a domain rule —
   *  what `tolerate` returns when the rule turns out not to be worth dying for. */
  let lastValid: Out | undefined;
  /**
   * Set after a rejected reply, so the next attempt is a correction rather than
   * a re-roll (T-164). Not set after malformed JSON: there is no coherent reply
   * to hand back, and asking a model to repair a broken brace works worse than
   * asking again.
   */
  let repair: { previous: string; problem: string } | undefined;

  // Two attempts total: one retry for a model that returns malformed or
  // mis-shaped JSON. Errors thrown by complete() itself (truncation, missing
  // key, refusal, SDK failures after its own retries) propagate immediately —
  // retrying those would just repeat the same failure.
  for (let attempt = 0; attempt < 2; attempt++) {
    lastRaw = await complete({
      system,
      user,
      name: def.name,
      model,
      reasoningEffort,
      maxTokens: def.maxTokens,
      jsonSchema: def.jsonSchema,
      ...(def.timeoutMs !== undefined ? { timeoutMs: def.timeoutMs } : {}),
      ...(def.maxRetries !== undefined ? { maxRetries: def.maxRetries } : {}),
      ...(repair ? { repair } : {}),
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripFences(lastRaw));
    } catch {
      repair = undefined;
      continue; // malformed JSON — retry once, then fall through to throw
    }
    const result = def.schema.safeParse(parsed);
    if (result.success) {
      if (!def.validate) return result.data;
      lastValid = result.data;
      try {
        def.validate(result.data);
        return result.data;
      } catch (error) {
        lastDomainError = error;
        // Last attempt: surface the domain error itself, which names the rule
        // that was broken, rather than a generic shape complaint.
        if (attempt === 1) break;
        // Logged, not just kept. When both attempts break a rule the thrown
        // error is the *second* one, and whether the first broke the same rule
        // decides what the fix is: the same rule twice is a prompt that does
        // not carry, two different rules is a model having a bad day.
        console.warn(`${def.name}: attempt 1 failed validation, retrying — ${String(error)}`);
        repair = { previous: lastRaw, problem: String(error) };
        continue;
      }
    }
    // Valid JSON, wrong shape. Worth repairing for the same reason a domain
    // failure is: the model has the content right and a field wrong.
    repair = {
      previous: lastRaw,
      problem: result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; '),
    };
  }

  if (lastDomainError) {
    /**
     * The rule broke twice and the caller says it is not worth the course
     * (T-164). The reply is returned as it stands; the caller's own validator
     * runs tolerantly over the same data and is what records the warning, so
     * the rule is still checked and still reported — just not fatal.
     */
    if (lastValid !== undefined && def.tolerate?.(lastDomainError)) return lastValid;
    throw lastDomainError;
  }

  // Second attempt still failed. Report why based on the last response.
  try {
    JSON.parse(stripFences(lastRaw));
  } catch {
    throw new LlmError('invalid_json', `${def.name}: response was not valid JSON`, lastRaw);
  }
  throw new LlmError('invalid_shape', `${def.name}: response did not match schema`, lastRaw);
}
