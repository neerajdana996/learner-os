import { gradeExplanation } from '../generator/grade.js';
import type { ItemPayload } from '@learnos/shared';

export interface Grade {
  correct: boolean;
  /** One line shown to the learner right after they answer (T-029). */
  feedback: string;
}

/**
 * A code answer, compared as code.
 *
 * `normalise()` is right for prose and catastrophic here: it strips every
 * character that is not a letter, a digit or a space, so `lo < hi` and
 * `lo <= hi` become the same string — and `<=` versus `<` is the single most
 * common wrong answer to the boundary question this format exists to ask. It
 * also lowercases, and `Lo` is not `lo` in any language we generate.
 *
 * Whitespace is the only thing forgiven, because a blank holds an expression
 * and `lo<hi` is the same expression as `lo < hi`.
 */
function normaliseCode(value: string): string {
  return value.replace(/\s+/g, '');
}

function matchesCode(response: string, answer: string, accept: readonly string[] = []): boolean {
  const given = normaliseCode(response);
  return [answer, ...accept].some((candidate) => normaliseCode(candidate) === given);
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

  /**
   * A `numeric` answer block decides how to grade, whatever the item's `type`
   * (T-108). It carries its own `tolerance` because the question is usually an
   * estimate: a capacity answer wants an order of magnitude, not equality, and
   * the fixed 1% used for text answers would mark a correct estimate wrong.
   *
   * Checked before the switch because the block, not the type, is the answer
   * surface. Without this the field was written by the generator and read by
   * nothing, and a numeric answer fell through to string matching — which is
   * the exact failure the block exists to prevent, since `6GB`, `6e9` and
   * `6,000,000,000` are one answer with infinitely many spellings.
   */
  const answerBlock = payload.blocks?.find((b) => b.slot === 'answer');

  /**
   * Fill in the blank (T-086). Whitespace is normalised before comparing, so
   * `lo<=hi` and `lo <= hi` are the same answer — the question is about the
   * boundary, never about spacing.
   *
   * Two holes are **one** boolean. Partial credit would report a learner who
   * got the boundary right and the variable wrong as half-remembering, and the
   * measurement has no room for half.
   */
  if (answerBlock?.kind === 'clozeCode') {
    const given = text.split('\n');
    const correct = answerBlock.holes.every((hole, i) =>
      matchesCode(given[i] ?? '', hole.answer, hole.accept),
    );
    return {
      correct,
      // `failure` names the concrete input where the likely wrong answer breaks
      // — a far better correction than restating the right token (T-083).
      feedback: correct ? 'Correct.' : answerBlock.failure,
    };
  }

  /**
   * Write the code (T-088).
   *
   * The client never receives `cases[].expect` (T-080): three named expected
   * outputs largely give the function away, and withholding them is also what
   * makes the design's own goal reachable — a learner cannot tell a JS item
   * from a Python one, because both round-trip to the server to be judged.
   *
   * So the client posts what the code *actually produced*, keyed by case name,
   * and the comparison happens here. A case the client did not report is a
   * failure, not a skip: a runner that crashed before reaching case three has
   * not passed case three.
   */
  if (answerBlock?.kind === 'codeEditor') {
    let produced: Record<string, string>;
    try {
      produced = JSON.parse(text) as Record<string, string>;
    } catch {
      return { correct: false, feedback: 'That did not run. Check the function returns something.' };
    }

    const failed = answerBlock.cases.filter(
      (c) => normaliseCode(produced[c.name] ?? '\u0000') !== normaliseCode(c.expect),
    );
    return {
      correct: failed.length === 0,
      feedback:
        failed.length === 0
          ? 'Correct — every case passed.'
          : `Not yet — ${failed.map((c) => c.name).join(', ')} still ${failed.length === 1 ? 'fails' : 'fail'}.`,
    };
  }

  /**
   * Put the lines in order (T-114).
   *
   * `order` is the answer key: indices into the shuffled `lines`, in the
   * correct sequence. The learner sends the arrangement they built, so the
   * comparison is the two index lists, not the text — identical lines would
   * otherwise compare equal in the wrong positions.
   */
  if (answerBlock?.kind === 'orderLines') {
    const correct = text.trim() === answerBlock.order.join(',');
    return {
      correct,
      // `swapBreaks` names which two lines, swapped, break it and how — the
      // reason the order mattered, which is the thing worth remembering.
      feedback: correct ? 'Correct.' : answerBlock.swapBreaks,
    };
  }

  /**
   * Click the line that is wrong (T-087).
   *
   * `acceptAdjacent` is the honest catch in this format: when the fix is an
   * *insertion*, the line that should change is not on screen, so the generator
   * marks the line that has to change and the neighbour counts too. Without it
   * the format would mark a learner wrong for pointing at the right place.
   */
  if (answerBlock?.kind === 'hotspotLine') {
    const chosen = typeof response === 'number' ? response : Number.parseInt(text, 10);
    const distance = Math.abs(chosen - answerBlock.line);
    const correct = distance === 0 || (answerBlock.acceptAdjacent === true && distance === 1);
    return {
      correct,
      feedback: correct ? answerBlock.why : answerBlock.failure,
    };
  }

  const numericBlock = payload.blocks?.find((b) => b.kind === 'numeric' && b.slot === 'answer');
  if (numericBlock && numericBlock.kind === 'numeric') {
    const given = Number.parseFloat(text.replace(/[\s,]/g, ''));
    if (!Number.isFinite(given)) {
      return { correct: false, feedback: 'That is not a number — give a figure, without units.' };
    }
    const { answer, tolerance, unit } = numericBlock;
    // Relative to the expected value, so one tolerance works at every scale.
    // An exact zero has no relative window, so fall back to absolute.
    const allowed = answer === 0 ? tolerance : Math.abs(answer) * tolerance;
    const correct = Math.abs(given - answer) <= allowed;
    const shown = unit ? `${answer} ${unit}` : String(answer);
    return { correct, feedback: correct ? 'Correct.' : `Not quite — the answer is about ${shown}.` };
  }

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
