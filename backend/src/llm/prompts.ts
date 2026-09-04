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
 *
 * Substituted values are user-authored (a topic title now; a learner's free-text
 * answer once T-011 grades explanations). Templates wrap each placeholder in an
 * XML-ish tag and tell the model to treat the contents as data, so angle
 * brackets are escaped here — otherwise a value containing `</topic>` could
 * close the tag early and have the rest read as instructions.
 */
export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => {
    if (!(key in vars)) throw new Error(`prompt template references unknown var: {{${key}}}`);
    return escapeDelimiters(vars[key] ?? '');
  });
}

function escapeDelimiters(value: string): string {
  return value.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
