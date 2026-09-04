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

export { LlmError };
