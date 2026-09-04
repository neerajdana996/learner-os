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

export { DEFAULT_MODEL, openai, complete } from './client.js';
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
  model?: string;
  maxTokens?: number;
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

export async function runPrompt<Vars extends Record<string, string>, Out>(
  def: PromptDef<Vars, Out>,
  vars: Vars,
): Promise<Out> {
  const tpl = loadTemplate(def.name);
  const system = tpl.example ? `${tpl.system}\n\n## Example\n${tpl.example}` : tpl.system;
  const user = render(tpl.user, vars);

  let lastRaw = '';
  // Two attempts total: one retry for a model that returns malformed or
  // mis-shaped JSON. Errors thrown by complete() itself (truncation, missing
  // key, SDK failures after its own retries) propagate immediately — retrying
  // those would just repeat the same failure.
  for (let attempt = 0; attempt < 2; attempt++) {
    lastRaw = await complete({ system, user, model: def.model, maxTokens: def.maxTokens });
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripFences(lastRaw));
    } catch {
      continue; // malformed JSON — retry once, then fall through to throw
    }
    const result = def.schema.safeParse(parsed);
    if (result.success) return result.data;
    // valid JSON but wrong shape — retry once, then throw
  }

  // Second attempt still failed. Report why based on the last response.
  try {
    JSON.parse(stripFences(lastRaw));
  } catch {
    throw new LlmError('invalid_json', `${def.name}: response was not valid JSON`, lastRaw);
  }
  throw new LlmError('invalid_shape', `${def.name}: response did not match schema`, lastRaw);
}
