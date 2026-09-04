// Loads and renders file-based prompts. A prompt lives at
//   src/llm/prompts/<name>/system.md   (static system prompt, required)
//   src/llm/prompts/<name>/user.md     (user message template with {{vars}}, required)
//   src/llm/prompts/<name>/example.md  (few-shot example, optional)
// Editing prompt text = editing a .md file; no code change, easy to diff/QA.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PROMPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'prompts');

export interface PromptTemplate {
  system: string;
  user: string;
  example?: string;
}

export function loadTemplate(name: string): PromptTemplate {
  const dir = join(PROMPTS_DIR, name);
  const system = readFileSync(join(dir, 'system.md'), 'utf8').trim();
  const user = readFileSync(join(dir, 'user.md'), 'utf8').trim();
  const examplePath = join(dir, 'example.md');
  const example = existsSync(examplePath) ? readFileSync(examplePath, 'utf8').trim() : undefined;
  return { system, user, example };
}

/**
 * Replaces `{{var}}` occurrences with values. Throws on a placeholder with no
 * matching var, so a template/caller mismatch fails loudly instead of sending
 * a literal `{{topic}}` to the model.
 */
export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => {
    if (!(key in vars)) throw new Error(`prompt template references unknown var: {{${key}}}`);
    return vars[key] ?? '';
  });
}
