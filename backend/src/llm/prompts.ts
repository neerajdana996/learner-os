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
  const rendered = renderSections(template, vars).replace(
    /\{\{\s*(\w+)\s*\}\}/g,
    (_match, key: string) => {
      if (!(key in vars)) throw new Error(`prompt template references unknown var: {{${key}}}`);
      return escapeDelimiters(vars[key] ?? '');
    },
  );
  // Anything still holding a `{{` is a section marker that didn't match the
  // line-shaped form above — a typo, or a `{{#x}}` opened without its `{{/x}}`.
  // Left alone it would ship braces to the model as if they were prose.
  const leftover = rendered.match(/\{\{[^}]*\}?\}?/);
  if (leftover) throw new Error(`prompt template has an unrendered marker: ${leftover[0]}`);
  return rendered;
}

/**
 * Optional sections: `{{#var}}…{{/var}}` on its own line is kept when `var` is
 * a non-empty string and removed — with its line — when it is empty.
 *
 * A plain `{{var}}` cannot express this. Passing an empty string leaves
 * `Language: ` sitting in the prompt, which is worse than saying nothing: it
 * reads as a field the model is expected to fill in. Building the whole line in
 * the caller doesn't work either, because `render` escapes `<` and `>` in a
 * substituted value — correctly, since values are learner-supplied — so the
 * line's own delimiting tags would arrive as `&lt;language&gt;`.
 *
 * Deliberately one line at a time, not a general block engine. The `m` flag
 * anchors `^` to a line start, and the trailing newline is consumed with the
 * section so an omitted line leaves no blank one behind.
 */
function renderSections(template: string, vars: Record<string, string>): string {
  return template.replace(
    /^([ \t]*)\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\2\}\}[ \t]*(\r?\n)?/gm,
    (_match, indent: string, key: string, body: string, newline: string | undefined) => {
      if (!(key in vars)) throw new Error(`prompt template references unknown var: {{#${key}}}`);
      return vars[key] ? `${indent}${body}${newline ?? ''}` : '';
    },
  );
}

function escapeDelimiters(value: string): string {
  return value.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
