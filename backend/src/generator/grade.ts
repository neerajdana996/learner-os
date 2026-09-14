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
  // Same request-path bound as `gradeCode` (T-171).
  timeoutMs: 20_000,
  maxRetries: 1,
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

/**
 * Strict structured output: the provider guarantees the reply's shape, which
 * removes malformed JSON — and its retry, doubling latency on a request a
 * learner is waiting on — as a failure mode. Strict mode requires every
 * property in `required`, so an absent `feedback` is sent as `""` and
 * normalised away in `gradeCode`.
 */
const codeGradeJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['cases', 'feedback'],
  properties: {
    cases: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'passed'],
        properties: { name: { type: 'string' }, passed: { type: 'boolean' } },
      },
    },
    feedback: { type: 'string' },
  },
} as const satisfies Record<string, unknown>;

export const gradeCodePrompt = definePrompt({
  name: 'gradeCode',
  schema: CodeGradeSchema,
  jsonSchema: { name: 'code_grade', schema: codeGradeJsonSchema as unknown as Record<string, unknown> },
  maxTokens: 1024,
  // A learner is waiting. Live p90 is ~3s; 20s per attempt and one SDK retry
  // bounds the worst case near 40s, after which the 500 lets the extension's
  // offline queue keep the answer and retry later.
  timeoutMs: 20_000,
  maxRetries: 1,
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
  const judged = await runPrompt(gradeCodePrompt, {
    lang: input.lang,
    signature: input.signature,
    source: input.source,
    cases: JSON.stringify(input.cases, null, 2),
  });
  // Strict mode sends `""` where the prompt says to omit it.
  return judged.feedback?.trim() ? judged : { cases: judged.cases };
}

export { LlmError };
