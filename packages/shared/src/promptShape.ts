/**
 * Does a prompt ask the learner to *write code*? (T-175)
 *
 * One definition, two readers, because they have to agree:
 *
 * - the generator rejects an item whose prompt demands code but carries no
 *   `codeEditor` block (`validateItems`), and
 * - `QuestionCard` gives such a prompt room to write code when an item somehow
 *   still arrives without one.
 *
 * The failure it exists to stop: *"Write a component that increments a counter
 * when a button is clicked."* rendered as a one-line box captioned "A few words
 * is enough", with a full JSX snippet as its stored answer. Three different
 * ideas of what the answer is, on one card.
 *
 * **Narrow on purpose**, in the same spirit as `REFERS_TO_SHOWN`. It needs an
 * imperative to *produce* something and a noun naming a multi-line artefact,
 * close together. A one-liner — "Write the setter call", "Write the condition
 * that stops the loop" — is a fine plain item and must not be caught; those are
 * what `clozeCode` and short answers are for. `write about` is excluded because
 * it asks for prose.
 */
export const WANTS_WRITTEN_CODE =
  /\b(?:write|implement|build|create|code)\b(?!\s+about)[^.?!]{0,80}\b(?:function|component|hook|class|method|module|reducer|middleware|generator|script|query|endpoint|handler|test)\b/i;

export function wantsWrittenCode(prompt: string): boolean {
  return WANTS_WRITTEN_CODE.test(prompt);
}
