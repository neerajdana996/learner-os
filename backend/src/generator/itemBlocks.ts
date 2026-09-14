import { z } from 'zod';
import { definePrompt, runPrompt } from '../llm/index.js';
import { GenerationError } from './errors.js';
import {
  MAX_RICH_ITEMS,
  itemVariants,
  parseGeneratedItem,
  type GeneratedItem,
} from './items.js';

/**
 * A second pass that upgrades a few of a concept's items to a rich answer
 * format (T-166).
 *
 * **Why a second pass at all.** Items are generated a batch of concepts at a
 * time (T-162), and across two full live generations that produced *zero*
 * blocks in 187 items — not for want of asking. Six isolated calls varying only
 * the number of concepts in the batch found the cause: blocks appear at one
 * concept per reply and never at two, three or four. The model is not refusing;
 * a reply carrying ~28 items over eleven block variants makes it drop the
 * optional, structurally expensive field, every time. Three separate prompt
 * fixes had already failed against that, which is what ruled out persuasion.
 *
 * So the batch keeps writing the questions — its cross-concept discrimination
 * items are the reason T-162 exists and they work — and this pass makes the one
 * small decision the batch cannot: *for this concept alone, which one or two of
 * these questions would be better asked as code?* Measured at four upgrades in
 * four runs against the same input, where the batch managed none in 187 items.
 *
 * **Scoped to `code`.** `systems` concepts reach for `diagram` and `sequence`,
 * which are content blocks — they change what the learner reads, not how they
 * answer, so there is nothing here for them to upgrade *to*. Widening this is a
 * separate decision with its own evidence.
 */

/** The item as the model is shown it — numbered, so `replaces` can name one. */
function formatItems(items: GeneratedItem[]): string {
  return items
    .map((item, i) => {
      const p = item.payload;
      const answer = 'answer' in p ? p.answer : 'rubric' in p ? `(rubric) ${p.rubric}` : '(options)';
      return `${i + 1}. [${p.type}]${item.isTransfer ? ' [transfer]' : ''} ${p.prompt}\n   answer: ${answer}`;
    })
    .join('\n');
}

const UpgradeSchema = z.object({
  /** 1-based, into the list the prompt was shown. */
  replaces: z.number().int().min(1),
  item: z.unknown(),
});

const UpgradesResponseSchema = z.object({ upgrades: z.array(UpgradeSchema) });

const upgradesJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['upgrades'],
  properties: {
    upgrades: {
      type: 'array',
      // The cap is in the schema as well as the prose because it is the whole
      // point of this pass: a small reply is what makes the blocks appear.
      maxItems: MAX_RICH_ITEMS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['replaces', 'item'],
        properties: { replaces: { type: 'integer' }, item: itemVariants },
      },
    },
  },
} as const satisfies Record<string, unknown>;

export const itemBlocksPrompt = definePrompt({
  name: 'itemBlocks',
  schema: UpgradesResponseSchema,
  jsonSchema: { name: 'item_upgrades', schema: upgradesJsonSchema as unknown as Record<string, unknown> },
});

export interface EnrichInput {
  topic: string;
  level: string;
  spine: string;
  concept: string;
  summary: string;
  language?: string | undefined;
  items: GeneratedItem[];
}

/**
 * Returns the concept's items with up to `MAX_RICH_ITEMS` of them replaced.
 *
 * **Never throws.** The caller is holding a complete, usable course: every item
 * is answerable and the only thing at stake is whether two of them are nicer to
 * answer. That is `severity.ts`'s preference side by definition, so a failure
 * here returns the input unchanged and the reason is reported as a warning
 * rather than ending a topic that cost nineteen calls and six minutes.
 *
 * Deliberately not routed through `isRepairable`: `REPAIRABLE_REASONS` is
 * shared with the items pass, and loosening it to swallow this would loosen it
 * there too.
 */
export async function enrichConceptItems(
  input: EnrichInput,
): Promise<{ items: GeneratedItem[]; warning?: string }> {
  let response: z.infer<typeof UpgradesResponseSchema>;
  try {
    response = await runPrompt(
      itemBlocksPrompt,
      {
        topic: input.topic,
        level: input.level,
        spine: input.spine,
        concept: input.concept,
        summary: input.summary,
        language: input.language ?? '',
        items: formatItems(input.items),
      },
      {},
    );
  } catch (error) {
    return { items: input.items, warning: `enrichment call failed: ${String(error)}` };
  }

  const upgraded = [...input.items];
  const replaced = new Set<number>();

  for (const upgrade of response.upgrades) {
    const index = upgrade.replaces - 1;
    const original = upgraded[index];

    // A `replaces` outside the list, or the same item twice, is the model
    // losing track of the numbering rather than a course problem — drop that
    // upgrade and keep the rest.
    if (!original || replaced.has(index)) continue;

    // A transfer item applies the idea in a setting it was not taught in, and
    // a blank cut into the taught listing is not transfer whatever it is
    // labelled. `isTransfer` is a measured outcome, so this one is enforced
    // here rather than trusted to the prompt.
    if (original.isTransfer) continue;

    let parsed: GeneratedItem;
    try {
      // The same parse the first pass uses, so an upgrade cannot be a shape the
      // generator could never have produced — and this is what resolves the
      // block's line *quotes* into indices.
      parsed = parseGeneratedItem(upgrade.item);
    } catch {
      continue;
    }

    // Changing the type or the transfer flag would change what is measured, not
    // how it is asked.
    if (parsed.payload.type !== original.payload.type) continue;

    upgraded[index] = { payload: parsed.payload, isTransfer: original.isTransfer };
    replaced.add(index);
  }

  return { items: upgraded };
}

export { GenerationError };
