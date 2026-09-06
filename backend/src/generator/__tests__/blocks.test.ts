/**
 * T-080 — turning what the model returned into what we store.
 *
 * The line-quote resolution is the point. Models miscount line numbers
 * constantly, and a wrong number is invisible: nothing throws, the item stores
 * fine, and a learner sees an annotation pointing at the wrong line on day 6.
 * An unmatched quote fails here instead, before anything is written.
 */
import { describe, expect, it } from 'vitest';
import { resolveLine, toItemPayload, parseGeneratedItemBlocks } from '../blocks.js';
import { GenerationError } from '../errors.js';
import { ItemPayloadSchema, ItemGenerationSchema } from '../../shared/index.js';

const SRC = ['function search(a, x) {', '  let lo = 0;', '  let hi = a.length;', '  return -1;', '}'].join('\n');

const genItem = (blocks: unknown[]) => ({
  type: 'application',
  prompt: 'Fix the bound.',
  answer: 'lo < hi',
  accept: [],
  isTransfer: false,
  blocks,
});

const orderLines = (lines: string[]) => ({
  kind: 'orderLines',
  slot: 'answer',
  lang: 'javascript',
  lines,
  swapBreaks: 'swapping the subscribe and the setup leaves t undefined',
});

const genCode = (over: Record<string, unknown> = {}) => ({
  kind: 'code',
  slot: 'context',
  lang: 'javascript',
  src: SRC,
  notes: [],
  ...over,
});

describe('resolveLine', () => {
  it('finds the line by its text, ignoring indentation', () => {
    // The model reliably quotes a line's content and unreliably reproduces its
    // leading whitespace.
    expect(resolveLine(SRC, 'let hi = a.length;', 'note')).toBe(3);
    expect(resolveLine(SRC, '      let hi = a.length;   ', 'note')).toBe(3);
  });

  it('falls back to a substring match for a partial quote', () => {
    expect(resolveLine(SRC, 'a.length', 'note')).toBe(3);
  });

  it('fails when the quote matches no line', () => {
    expect(() => resolveLine(SRC, 'while (lo < hi)', 'note')).toThrow(GenerationError);
    expect(() => resolveLine(SRC, 'while (lo < hi)', 'note')).toThrow(/not in the listing/);
  });

  it('fails when the quote matches two lines rather than picking the first', () => {
    // An ambiguous reference in a listing with two identical lines is a coin
    // flip; the model has to quote more of it.
    const dupes = ['a();', 'b();', 'a();'].join('\n');
    expect(() => resolveLine(dupes, 'a();', 'note')).toThrow(/matches 2 lines \(1, 3\)/);
  });

  it('names what was being resolved, so the error says which block', () => {
    expect(() => resolveLine(SRC, 'nope', 'block 2 (code) note 1')).toThrow(/block 2 \(code\) note 1/);
  });
});

describe('toItemPayload', () => {
  const parse = (raw: unknown) => toItemPayload(ItemGenerationSchema.parse(raw));

  it('turns note quotes into line numbers', () => {
    const out = parse(genItem([genCode({ notes: [{ lineQuote: 'let hi = a.length;', text: 'the bound' }] })]));
    const parsed = ItemPayloadSchema.parse(out);
    expect((parsed.blocks?.[0] as { notes: { line: number }[] }).notes[0]?.line).toBe(3);
  });

  it('turns a dim range into two line numbers', () => {
    const out = parse(genItem([genCode({ dim: { fromQuote: 'let lo = 0;', toQuote: 'return -1;' } })]));
    const parsed = ItemPayloadSchema.parse(out);
    expect((parsed.blocks?.[0] as { dim: { from: number; to: number } }).dim).toEqual({ from: 2, to: 4 });
  });

  it('turns a hotspot quote into a line number', () => {
    const out = parse(
      genItem([
        {
          kind: 'hotspotLine',
          slot: 'answer',
          lang: 'javascript',
          src: SRC,
          lineQuote: 'return -1;',
          why: 'the search never ran',
          failure: 'search([4], 4) returns -1 because the loop never ran',
          acceptAdjacent: false,
        },
      ]),
    );
    const parsed = ItemPayloadSchema.parse(out);
    expect((parsed.blocks?.[0] as { line: number }).line).toBe(4);
    // The quote form must not survive into the stored payload.
    expect(parsed.blocks?.[0]).not.toHaveProperty('lineQuote');
  });

  it('leaves a plain item — no blocks — exactly as it was', () => {
    const plain = { type: 'recall', prompt: 'What is a stoma?', answer: 'a pore', accept: [], isTransfer: false };
    expect(toItemPayload(ItemGenerationSchema.parse(plain))).toEqual(ItemGenerationSchema.parse(plain));
  });
});

describe('orderLines is shuffled by the worker, not the model', () => {
  const correct = ['const t = setup();', 'subscribe(t);', 'return () => teardown(t);', 'log(t);'];
  const build = () =>
    toItemPayload(
      ItemGenerationSchema.parse(genItem([orderLines(correct)])),
    );

  it('stores a permutation of the model’s lines with the key alongside', () => {
    const parsed = ItemPayloadSchema.parse(build());
    const block = parsed.blocks?.[0] as { lines: string[]; order: number[] };

    expect([...block.lines].sort()).toEqual([...correct].sort());
    // `order` reads the shuffled lines back into the correct sequence.
    expect(block.order.map((i) => block.lines[i])).toEqual(correct);
  });

  it('shuffles the same way every time, so two learners get the same puzzle', () => {
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });

  it('never stores the lines already in order', () => {
    // A four-line shuffle lands on the identity once in twenty-four, and a
    // pre-solved puzzle scores as a correct answer nobody gave. Checked over
    // many line sets rather than one, since the shuffle is seeded by content.
    for (let n = 0; n < 200; n++) {
      const lines = ['a', 'b', 'c', 'd'].map((l) => `${l}${n}();`);
      const out = toItemPayload(
        ItemGenerationSchema.parse(genItem([orderLines(lines)])),
      ) as { blocks: { lines: string[] }[] };
      expect(out.blocks[0]?.lines, `seed ${n} came back in order`).not.toEqual(lines);
    }
  });
});

describe('parseGeneratedItemBlocks', () => {
  it('rejects a model response carrying a field the generation schema does not list', () => {
    // The XSS class this closes by construction: no model-writable field
    // accepts markup, so the model cannot emit any.
    expect(() => parseGeneratedItemBlocks(genItem([genCode({ svg: '<svg onload="x()"/>' })]))).toThrow(GenerationError);
    expect(() => parseGeneratedItemBlocks(genItem([genCode({ tokens: [['kw', 0, 3]] })]))).toThrow(/invalid application payload/);
  });

  it('rejects a numeric line and names the field', () => {
    expect(() => parseGeneratedItemBlocks(genItem([genCode({ notes: [{ line: 3, text: 'x' }] })]))).toThrow(/blocks/);
  });

  it('surfaces an unresolvable quote as a generation error, not a crash', () => {
    expect(() =>
      parseGeneratedItemBlocks(genItem([genCode({ notes: [{ lineQuote: 'not in here', text: 'x' }] })])),
    ).toThrow(/quoted line is not in the listing/);
  });

  it('produces something ItemPayloadSchema accepts', () => {
    const out = parseGeneratedItemBlocks(genItem([genCode({ notes: [{ lineQuote: 'let lo = 0;', text: 'start' }] })]));
    expect(ItemPayloadSchema.safeParse(out).success).toBe(true);
  });
});
