import { describe, expect, it } from 'vitest';
import { wantsWrittenCode } from '../promptShape.js';

/**
 * T-175. The rule that stops "Write a component…" being asked in a one-line
 * box. Both halves matter: catching the real thing, and leaving one-liners
 * alone — a false positive costs a regenerated item for no reason.
 */
describe('wantsWrittenCode', () => {
  it('catches a prompt that asks for a whole artefact', () => {
    for (const prompt of [
      'Write a component that increments a counter when a button is clicked.',
      'Implement a debounce function.',
      'Write a SQL query that returns the five most recent topics.',
      'Create a reducer that handles add and remove.',
      'Build a middleware that logs the request id.',
      'Write a test that fails before the fix.',
    ]) {
      expect(wantsWrittenCode(prompt), prompt).toBe(true);
    }
  });

  /** Every one of these is a good plain item, and some are real prompts from
   *  `backend/fixtures`. Rejecting them would cost items to catch nothing. */
  it('leaves one-liners and prose questions alone', () => {
    for (const prompt of [
      'You need to toggle a boolean `isOpen` reliably even when several toggles are queued in one event. Write the setter call.',
      'Explain why a state setter can be called with a function instead of a value.',
      'What does useState return when you call it?',
      'Which statement best describes why state updates in React are asynchronous?',
      'Write the condition that stops the loop.',
      'Write about the function of a reducer, in two sentences.',
    ]) {
      expect(wantsWrittenCode(prompt), prompt).toBe(false);
    }
  });

  /** The verb and the noun have to be in the same breath: a later sentence
   *  mentioning a function is not a request to write one. */
  it('does not match a noun a sentence away from the verb', () => {
    expect(
      wantsWrittenCode('Write the missing line. The surrounding function already closes over count.'),
    ).toBe(false);
  });
});
