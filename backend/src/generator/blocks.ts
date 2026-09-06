// Derives a stored `ItemPayload` from what the model returned (T-080).
//
// Server-only, and deliberately NOT in `src/shared`: the clients never resolve
// anything — they receive blocks already resolved and already stripped. Keeping
// it here also means the one place that turns model output into stored rows is
// the same place that can refuse to.
//
// Two jobs, both of which exist because of how models actually fail:
//
//  1. **Line quotes → line numbers.** `note.lineQuote` and `hotspotLine`'s
//     `lineQuote` are matched against `src`. A wrong line *number* is invisible
//     until a learner sees an annotation pointing at the wrong line; an
//     unmatched quote fails here, before anything is stored. Two matching lines
//     fail too, rather than silently picking the first — an ambiguous reference
//     in a listing with two identical lines is a coin flip, and the model has
//     to disambiguate by quoting more of the line.
//  2. **Shuffling `orderLines`.** The model emits the lines in the correct
//     order; the shuffle and the answer key are computed here. Asking a model
//     for a permutation of its own list is a needless way to get an off-by-one.
import { ItemGenerationSchema, type Block, type BlockGeneration, type ItemGeneration } from '@learnos/shared';
import { GenerationError } from './errors.js';

/**
 * Finds the 1-based index of the single line matching `quote`.
 *
 * Compared trimmed, because the model reliably quotes a line's content and
 * unreliably reproduces its indentation. Falls back to a substring match so a
 * quote of the interesting half of a long line still resolves — but the
 * uniqueness rule applies to whichever pass matched, so a loose quote that hits
 * two lines still fails.
 */
export function resolveLine(src: string, quote: string, what: string): number {
  const lines = src.split('\n');
  const needle = quote.trim();

  const exact = lines.flatMap((line, i) => (line.trim() === needle ? [i + 1] : []));
  const hits = exact.length > 0 ? exact : lines.flatMap((line, i) => (line.includes(needle) ? [i + 1] : []));

  if (hits.length === 0) {
    throw new GenerationError('invalid_shape', `${what}: quoted line is not in the listing — ${JSON.stringify(needle)}`);
  }
  if (hits.length > 1) {
    throw new GenerationError(
      'invalid_shape',
      `${what}: quoted line matches ${hits.length} lines (${hits.join(', ')}) — quote more of it — ${JSON.stringify(needle)}`,
    );
  }
  return hits[0] as number;
}

/**
 * Deterministic shuffle, seeded from the lines themselves.
 *
 * Deterministic on purpose: every learner on a topic must get the same puzzle,
 * or two people are answering different questions and the item's statistics
 * pool nothing. Seeding from the content rather than a counter means the same
 * item shuffles the same way if it is ever regenerated.
 */
function shuffleSeeded<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const next = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0), h / 4294967296);

  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

function resolveBlock(b: BlockGeneration, where: string): Block {
  switch (b.kind) {
    case 'code': {
      // `dim` is pulled out of the spread rather than overwritten: leaving it in
      // would carry the quote form through whenever the resolved form is absent.
      const { dim, ...rest } = b;
      return {
        ...rest,
        notes: b.notes.map((note, i) => ({
          text: note.text,
          line: resolveLine(b.src, note.lineQuote, `${where} note ${i + 1}`),
        })),
        ...(dim
          ? {
              dim: {
                from: resolveLine(b.src, dim.fromQuote, `${where} dim.from`),
                to: resolveLine(b.src, dim.toQuote, `${where} dim.to`),
              },
            }
          : {}),
      };
    }

    case 'hotspotLine': {
      const { lineQuote, ...rest } = b;
      return { ...rest, line: resolveLine(b.src, lineQuote, `${where} hotspot`) };
    }

    case 'orderLines': {
      // `lines` arrives correct; store it shuffled with the key alongside.
      let shuffled = shuffleSeeded(b.lines, b.lines.join('\n'));
      // A four-line shuffle lands on the identity once in twenty-four, and a
      // pre-solved puzzle scores as a correct answer nobody gave. Rotating is
      // enough — it is deterministic and never the identity for n ≥ 2.
      if (shuffled.every((line, i) => line === b.lines[i])) {
        shuffled = [...shuffled.slice(1), shuffled[0] as string];
      }
      return { ...b, lines: shuffled, order: b.lines.map((line) => shuffled.indexOf(line)) };
    }

    default:
      return b;
  }
}

/**
 * One raw item from the model → the payload we store.
 *
 * Validates against `ItemGenerationSchema` rather than `ItemPayloadSchema`, so
 * a response carrying `svg`, pre-highlighted `tokens`, or a bare line number is
 * rejected at the boundary instead of being carried through — every generation
 * block is `.strict()` and that is what makes "the model cannot emit markup" a
 * property of the code rather than a promise in a prompt.
 */
export function toItemPayload(generated: ItemGeneration): unknown {
  if (!generated.blocks) return generated;
  return {
    ...generated,
    blocks: generated.blocks.map((b, i) => resolveBlock(b, `block ${i + 1} (${b.kind})`)),
  };
}

/** Parse-and-resolve, for callers holding an unvalidated response. */
export function parseGeneratedItemBlocks(raw: unknown): unknown {
  const result = ItemGenerationSchema.safeParse(raw);
  if (!result.success) {
    const type = (raw as { type?: unknown } | null)?.type;
    const label = typeof type === 'string' ? type : 'item';
    throw new GenerationError(
      'invalid_shape',
      `invalid ${label} payload: ${result.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
    );
  }
  return toItemPayload(result.data);
}
