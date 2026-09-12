import type { ConceptHardness } from '../generator/conceptMap.js';
import type { TeachMode } from '@learnos/shared';

/**
 * Which way a concept gets taught (T-161).
 *
 * This replaces a coin flip. `generator.worker.ts` chose between the two modes
 * with `rng() < 0.5`, which is not a tuning problem — it is the decision being
 * unmade. The modes are opposite prescriptions:
 *
 * - `try_first` puts the learner in front of the idea and lets them get it
 *   wrong before anything is explained. The wrong attempt is what makes the
 *   explanation land, and the effect depends on the learner having enough
 *   adjacent knowledge to produce a *meaningful* wrong answer.
 * - `example_first` shows a worked example first. This wins exactly where the
 *   other one fails: a learner with no foothold does not generate a productive
 *   wrong answer, they generate nothing, and the attempt is three minutes of
 *   frustration in a ten-minute day.
 *
 * So the question is not "which is better" — it is "does this learner have
 * something to be wrong *with*?" `hardBecause` is the map's answer to exactly
 * that, which is why the mode is derived from it rather than rolled.
 *
 * Kept as a pure function, separate from the generator, for two reasons: the
 * policy is then inspectable and unit-testable on its own, and it can be
 * changed without regenerating anybody's course — the stored `hardBecause` is
 * the observation, and this is only the reading of it.
 */
export function teachModeFor(hardness: ConceptHardness): TeachMode {
  switch (hardness) {
    // They already hold a belief, and it is wrong. Letting them commit to it
    // first is the entire value — being told up front that the intuitive
    // answer is wrong does not dislodge it, and getting it wrong does.
    case 'counterintuitive':
      return 'try_first';

    // They know something that looks like this and isn't. An attempt surfaces
    // which one they reached for, and that is the thing the explanation has to
    // address; an example first lets them read it as confirming what they knew.
    case 'confusable-neighbour':
      return 'try_first';

    // Nothing to reason from. An attempt here is a guess, and a guess teaches
    // nothing because there was never a belief to correct.
    case 'no-prior-hook':
      return 'example_first';

    // Each part is simple; holding them together is not. An attempt spends the
    // learner's working memory on assembling the parts rather than on the idea,
    // which is the one thing a worked example exists to prevent.
    case 'many-moving-parts':
      return 'example_first';

    // Real, needed, and nobody gets it wrong. A three-minute attempt buys
    // nothing here, and the day's attention is better spent on a crux concept.
    case 'not-hard':
      return 'example_first';
  }
}
