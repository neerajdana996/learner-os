import { gradeExplanation } from '../generator/grade.js';
import type { ItemPayload } from '@learnos/shared';

export interface Grade {
  correct: boolean;
  /** One line shown to the learner right after they answer (T-029). */
  feedback: string;
}

/** Relative tolerance for numeric answers, so 3.14 counts as 3.1416. */
const NUMERIC_TOLERANCE = 0.01;

/**
 * trim → lowercase → strip punctuation → collapse whitespace, so
 * `" The Answer. "` and `"the answer"` compare equal. Deliberately lenient:
 * we're testing whether the concept was remembered, not transcription.
 */
export function normalise(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function asNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** True when both sides parse as numbers and agree within ±1%. */
function numericallyEqual(expected: string, actual: string): boolean | null {
  const a = asNumber(expected);
  const b = asNumber(actual);
  if (a === null || b === null) return null;
  // Relative to the expected magnitude, falling back to absolute when the
  // expected answer is 0 (where a relative tolerance is undefined).
  const tolerance = a === 0 ? NUMERIC_TOLERANCE : Math.abs(a) * NUMERIC_TOLERANCE;
  return Math.abs(a - b) <= tolerance;
}

function matchesText(response: string, answer: string, accept: string[] = []): boolean {
  for (const candidate of [answer, ...accept]) {
    const numeric = numericallyEqual(candidate, response);
    if (numeric === true) return true;
    if (numeric === null && normalise(candidate) === normalise(response)) return true;
  }
  return false;
}

/**
 * Turns an application item's model answer into a rubric the grader can judge
 * against. Kept explicit so the grader is told to accept a different route to
 * the same result, which is the whole point of an application question.
 */
function applicationRubric(modelAnswer: string): string {
  return `A correct answer must reach the same result as this model answer, by any valid route: ${modelAnswer}`;
}

/**
 * Decides whether an answer is correct — on the server, always. The client
 * never sees the answer key (T-010 strips it), so it cannot grade, and a
 * client-supplied `correct` is never trusted: it would let a learner inflate
 * their own retention score, which is the one number the pilot exists to
 * measure.
 */
export async function grade(payload: ItemPayload, response: string | number): Promise<Grade> {
  const text = String(response);

  switch (payload.type) {
    case 'recognition': {
      const chosen = typeof response === 'number' ? response : Number.parseInt(text, 10);
      const correct = chosen === payload.answerIndex;
      return {
        correct,
        feedback: correct ? 'Correct.' : `Not quite — the answer is: ${payload.options[payload.answerIndex]}`,
      };
    }

    case 'recall': {
      // Short, canonical answers: string matching is the right tool and costs
      // nothing. `accept` carries the alternative phrasings.
      const correct = matchesText(text, payload.answer, payload.accept);
      return {
        correct,
        feedback: correct ? 'Correct.' : `Not quite — the answer is: ${payload.answer}`,
      };
    }

    case 'application': {
      // An application item asks the learner to *use* the concept on a concrete
      // problem, so the answer is a sentence in their own words. Matching that
      // against a short accept-list rejects correct answers almost every time —
      // and since these count toward the retention and transfer numbers the
      // pilot exists to produce, that is a broken instrument, not a strict one.
      //
      // Exact match stays as a fast accept path: a verbatim answer should not
      // cost a model call or two seconds of a learner's wait.
      if (matchesText(text, payload.answer, payload.accept)) {
        return { correct: true, feedback: 'Correct.' };
      }
      // Otherwise judge it, using the model answer as the rubric. Failures
      // propagate rather than defaulting to correct — see gradeExplanation.
      return gradeExplanation(applicationRubric(payload.answer), text);
    }

    case 'explain': {
      const result = await gradeExplanation(payload.rubric, text);
      return { correct: result.correct, feedback: result.feedback };
    }
  }
}
