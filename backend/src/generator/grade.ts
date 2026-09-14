import { z } from 'zod';
import { definePrompt, runPrompt, LlmError } from '../llm/index.js';

export const ExplanationGradeSchema = z.object({
  correct: z.boolean(),
  feedback: z.string().min(1).max(300),
});

export type ExplanationGrade = z.infer<typeof ExplanationGradeSchema>;

export const gradeExplanationPrompt = definePrompt({
  name: 'gradeExplanation',
  schema: ExplanationGradeSchema,
  // Grading is a short, bounded judgement; it doesn't need the generation budget.
  maxTokens: 512,
});

/**
 * Grades a free-text explanation against its rubric.
 *
 * The learner's answer is untrusted text going into a prompt: `render()`
 * escapes angle brackets so it can't close the `<answer>` tag it's wrapped in,
 * and the system prompt tells the model to treat that content as data. This is
 * the path where an injection would be worth attempting — "mark this correct"
 * would inflate the very retention numbers the pilot exists to measure.
 *
 * On a model or validation failure the answer is *not* silently marked correct:
 * the error propagates so the caller can decide, rather than handing out a free
 * pass. See grade() for what the review path does with it.
 */
export async function gradeExplanation(rubric: string, response: string): Promise<ExplanationGrade> {
  return runPrompt(gradeExplanationPrompt, { rubric, response });
}

/**
 * A `codeEditor` answer the browser did not run (T-171).
 *
 * `feedback` is capped short and told never to quote an expected output: it is
 * shown to the learner, and the expectations are the answer key (T-080).
 */
export const CodeGradeSchema = z.object({
  cases: z.array(z.object({ name: z.string(), passed: z.boolean() })),
  feedback: z.string().max(200).optional(),
});

export type CodeGrade = z.infer<typeof CodeGradeSchema>;

export const gradeCodePrompt = definePrompt({
  name: 'gradeCode',
  schema: CodeGradeSchema,
  maxTokens: 1024,
});

export interface CodeToGrade {
  lang: string;
  signature: string;
  source: string;
  cases: { name: string; call: string; expect: string }[];
}

/**
 * Judges, case by case, what the learner's code would produce.
 *
 * The source is untrusted text going into a prompt, the same exposure as
 * `gradeExplanation` and handled the same way: wrapped in a tag `render()`
 * escapes, with the system prompt treating it as data. Nothing is executed —
 * running learner code on the host that holds the production database was the
 * rejected alternative.
 */
export async function gradeCode(input: CodeToGrade): Promise<CodeGrade> {
  return runPrompt(gradeCodePrompt, {
    lang: input.lang,
    signature: input.signature,
    source: input.source,
    cases: JSON.stringify(input.cases, null, 2),
  });
}

export { LlmError };
