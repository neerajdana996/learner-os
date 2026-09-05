/**
 * T-080 — the block union, and the projection that keeps its answer keys off
 * the wire.
 *
 * The projection tests are deliberately written as *serialise and search*
 * rather than field by field. A field-by-field assertion only covers the fields
 * someone remembered; these fail when a future block gains an answer-bearing
 * field and nobody updates `toPublicBlock` — which is the failure mode worth
 * catching, because it leaks the pilot's measurement rather than crashing.
 */
import { describe, expect, it } from 'vitest';
import {
  BlockSchema,
  BlockGenerationSchema,
  ItemPayloadSchema,
  ItemGenerationSchema,
  answerKindOf,
  toPublicBlocks,
  type Block,
} from '../index.js';

const SRC = ['function search(a, x) {', '  let lo = 0;', '  let hi = a.length;', '  return -1;', '}'].join('\n');

// Every value here is one a client must never see. They are distinctive so the
// serialise-and-search assertions cannot pass by accident.
const codeBlock = (over: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  kind: 'code',
  slot: 'context',
  lang: 'javascript',
  src: SRC,
  notes: [],
  ...over,
});

const clozeBlock = (over: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  kind: 'clozeCode',
  slot: 'answer',
  lang: 'javascript',
  src: 'while (lo {{1}} hi) {',
  holes: [{ id: 1, answer: 'SECRETANSWER', accept: ['SECRETACCEPT'], width: 2 }],
  failure: 'SECRETFAILURE — search([4], 4) returns -1',
  ...over,
});

const hotspotBlock = (over: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  kind: 'hotspotLine',
  slot: 'answer',
  lang: 'javascript',
  src: SRC,
  line: 3,
  why: 'SECRETWHY',
  acceptAdjacent: false,
  ...over,
});

const orderBlock = (over: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  kind: 'orderLines',
  slot: 'answer',
  lang: 'javascript',
  lines: ['const t = setup();', 'subscribe(t);', 'return () => teardown(t);', 'log(t);'],
  order: [0, 1, 2, 3],
  ...over,
});

const editorBlock = (over: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  kind: 'codeEditor',
  slot: 'answer',
  lang: 'javascript',
  signature: 'debounce(fn, ms)',
  starter: 'function debounce(fn, ms) {}',
  skeleton: 'SECRETSKELETON',
  cases: [
    { name: 'runs once', call: 'debounce(f, 10)', expect: 'SECRETEXPECT1' },
    { name: 'coalesces', call: 'debounce(f, 10)()()', expect: 'SECRETEXPECT2' },
  ],
  ...over,
});

const revealBlock = (): Record<string, unknown> => ({
  kind: 'codeDiff',
  slot: 'reveal',
  lang: 'javascript',
  before: 'setTimeout(fn, ms);',
  after: 'SECRETREVEAL = setTimeout(fn, ms);',
});

const terminalBlock = (): Record<string, unknown> => ({
  kind: 'terminal',
  slot: 'context',
  command: 'node index.js',
  lines: [{ text: 'ok', stream: 'out' }, { text: 'TypeError: x is not a function', stream: 'err' }],
});

const proseBlock = (): Record<string, unknown> => ({ kind: 'prose', slot: 'context', text: 'Read this first.' });

const item = (blocks: unknown[], type = 'application') => ({
  type,
  prompt: 'Fix the bound.',
  answer: 'lo < hi',
  accept: [],
  blocks,
});

/** Every key name appearing anywhere in a value, however deeply nested. */
function deepKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => deepKeys(v, into));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      into.add(k);
      deepKeys(v, into);
    }
  }
  return into;
}

describe('every block kind parses', () => {
  it.each([
    ['prose', proseBlock()],
    ['code', codeBlock()],
    ['codeDiff', revealBlock()],
    ['terminal', terminalBlock()],
    ['clozeCode', clozeBlock()],
    ['hotspotLine', hotspotBlock()],
    ['orderLines', orderBlock()],
    ['codeEditor', editorBlock()],
  ])('%s', (_name, raw) => {
    const parsed = BlockSchema.safeParse(raw);
    expect(parsed.success, JSON.stringify(parsed.success ? {} : parsed.error.issues)).toBe(true);
  });
});

describe('slots', () => {
  it('rejects an answer block that is not in the answer slot', () => {
    const result = BlockSchema.safeParse(clozeBlock({ slot: 'context' }));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('slot');
  });

  it('rejects a content block claiming the answer slot', () => {
    const result = BlockSchema.safeParse(codeBlock({ slot: 'answer' }));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('cannot have slot');
  });
});

describe('cross-block rules', () => {
  it('rejects two answer blocks — two surfaces graded as one boolean', () => {
    const result = ItemPayloadSchema.safeParse(item([clozeBlock(), hotspotBlock()]));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('at most one answer block');
  });

  it('rejects an answer block on a recognition item — its answer surface is options', () => {
    const result = ItemPayloadSchema.safeParse({
      type: 'recognition',
      prompt: 'What prints?',
      options: ['a', 'b', 'c', 'd'],
      answerIndex: 1,
      blocks: [clozeBlock()],
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('cannot carry an answer block');
  });

  it('accepts a recognition item whose code listing is context — predict-the-output', () => {
    const result = ItemPayloadSchema.safeParse({
      type: 'recognition',
      prompt: 'What prints?',
      options: ['0 1 2', '3 3 3', '0 0 0', 'it throws'],
      answerIndex: 1,
      blocks: [codeBlock()],
    });
    expect(result.success).toBe(true);
  });

  it('rejects more than 3 context blocks and more than 2 reveals', () => {
    expect(ItemPayloadSchema.safeParse(item([proseBlock(), proseBlock(), proseBlock(), proseBlock()])).success).toBe(false);
    expect(ItemPayloadSchema.safeParse(item([revealBlock(), revealBlock(), revealBlock()])).success).toBe(false);
  });

  it('still parses an item with no blocks at all, which is every item today', () => {
    const result = ItemPayloadSchema.safeParse({ type: 'recall', prompt: 'What is a stoma?', answer: 'a pore' });
    expect(result.success && result.data.blocks).toBeUndefined();
  });
});

describe('cloze markers and holes must agree', () => {
  it('rejects a {{2}} marker with only one hole', () => {
    const result = BlockSchema.safeParse(clozeBlock({ src: 'while (lo {{1}} hi) { {{2}} }' }));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('{{2}} marker with no matching hole');
  });

  it('rejects a hole with no marker', () => {
    const result = BlockSchema.safeParse(
      clozeBlock({
        holes: [
          { id: 1, answer: '<', accept: [], width: 1 },
          { id: 2, answer: '+', accept: [], width: 1 },
        ],
      }),
    );
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('no {{2}} marker');
  });
});

describe('line references stay inside the listing', () => {
  it('rejects a note past the end', () => {
    const result = BlockSchema.safeParse(codeBlock({ notes: [{ line: 9, text: 'here' }] }));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('note points at line 9 of a 5-line listing');
  });

  it('rejects a hotspot past the end', () => {
    expect(BlockSchema.safeParse(hotspotBlock({ line: 99 })).success).toBe(false);
  });
});

describe('the short variant is what the extension pops', () => {
  it('rejects one over 8 lines', () => {
    const result = BlockSchema.safeParse(codeBlock({ short: Array.from({ length: 9 }, (_, i) => `l${i}`).join('\n') }));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('the popup fits 8');
  });

  it('rejects one that elided the line a note points at', () => {
    const result = BlockSchema.safeParse(
      codeBlock({ notes: [{ line: 3, text: 'the bound' }], short: 'function search(a, x) {\n  …\n}' }),
    );
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('elided the line');
  });

  it('accepts one that kept it', () => {
    expect(
      BlockSchema.safeParse(
        codeBlock({ notes: [{ line: 3, text: 'the bound' }], short: 'function search(a, x) {\n  let hi = a.length;\n}' }),
      ).success,
    ).toBe(true);
  });
});

describe('orderLines and codeEditor', () => {
  it('rejects an order that is not a permutation of the lines', () => {
    expect(BlockSchema.safeParse(orderBlock({ order: [0, 1, 2] })).success).toBe(false);
    expect(BlockSchema.safeParse(orderBlock({ order: [0, 1, 2, 2] })).success).toBe(false);
  });

  it('rejects fewer than two cases, and two cases sharing a name', () => {
    expect(BlockSchema.safeParse(editorBlock({ cases: [{ name: 'a', call: 'f()', expect: '1' }] })).success).toBe(false);
    const dupe = BlockSchema.safeParse(
      editorBlock({
        cases: [
          { name: 'same', call: 'f()', expect: '1' },
          { name: 'same', call: 'g()', expect: '2' },
        ],
      }),
    );
    expect(dupe.success).toBe(false);
    expect(JSON.stringify(dupe.error?.issues)).toContain('share a name');
  });
});

describe('the generation schema is what the model may return', () => {
  it('rejects svg, tokens, or any other field it was not given', () => {
    for (const extra of [{ svg: '<svg onload="x()"/>' }, { tokens: [['kw', 0, 3]] }, { anythingElse: 1 }]) {
      const result = BlockGenerationSchema.safeParse({ ...codeBlock({ notes: [] }), ...extra });
      expect(result.success, `${Object.keys(extra)[0]} should be rejected`).toBe(false);
    }
  });

  it('rejects a numeric line — the model quotes the line text instead', () => {
    expect(BlockGenerationSchema.safeParse(codeBlock({ notes: [{ line: 2, text: 'x' }] })).success).toBe(false);
    expect(BlockGenerationSchema.safeParse(hotspotBlock()).success).toBe(false);
  });

  it('accepts the quote form', () => {
    const result = BlockGenerationSchema.safeParse(
      codeBlock({ notes: [{ lineQuote: 'let hi = a.length;', text: 'the bound' }] }),
    );
    expect(result.success, JSON.stringify(result.success ? {} : result.error.issues)).toBe(true);
  });

  it('does not ask the model for the orderLines answer key', () => {
    // The worker shuffles and records `order`; a model asked for a permutation
    // of its own list is a needless way to get an off-by-one.
    const { order, ...withoutKey } = orderBlock();
    expect(order).toBeDefined();
    expect(BlockGenerationSchema.safeParse(withoutKey).success).toBe(true);
    expect(BlockGenerationSchema.safeParse(orderBlock()).success).toBe(false);
  });

  it('applies the same cross-block rules as the stored form', () => {
    const gen = { ...item([]), blocks: [clozeBlock(), clozeBlock()] };
    expect(ItemGenerationSchema.safeParse(gen).success).toBe(false);
  });
});

describe('the public projection never carries an answer key', () => {
  const answerBearing = ['answer', 'accept', 'expect', 'skeleton', 'failure', 'why', 'line', 'order', 'acceptAdjacent'];

  it.each([
    ['clozeCode', clozeBlock()],
    ['hotspotLine', hotspotBlock()],
    ['orderLines', orderBlock()],
    ['codeEditor', editorBlock()],
  ])('%s', (_name, answer) => {
    const parsed = ItemPayloadSchema.parse(item([proseBlock(), codeBlock(), answer, revealBlock()]));
    const publicBlocks = toPublicBlocks(parsed.blocks as Block[]);
    const json = JSON.stringify(publicBlocks);

    // Values: nothing a learner could read the answer off.
    for (const secret of ['SECRETANSWER', 'SECRETACCEPT', 'SECRETEXPECT1', 'SECRETEXPECT2', 'SECRETSKELETON', 'SECRETWHY', 'SECRETFAILURE', 'SECRETREVEAL']) {
      expect(json, `${secret} leaked`).not.toContain(secret);
    }

    // Keys: a block that gains an answer-bearing field later fails here even if
    // its value happens not to match a sentinel.
    const keys = deepKeys(publicBlocks);
    for (const forbidden of answerBearing) {
      expect([...keys], `public blocks expose "${forbidden}"`).not.toContain(forbidden);
    }
  });

  it('drops every reveal block outright — a reveal block is the answer', () => {
    const parsed = ItemPayloadSchema.parse(item([codeBlock(), clozeBlock(), revealBlock()]));
    const publicBlocks = toPublicBlocks(parsed.blocks as Block[]);
    expect(publicBlocks.map((b) => b.slot)).toEqual(['context', 'answer']);
  });
});

describe('answerKindOf', () => {
  it('is null for a plain prompt and for context-only blocks', () => {
    expect(answerKindOf(undefined)).toBeNull();
    expect(answerKindOf(ItemPayloadSchema.parse(item([codeBlock()])).blocks as Block[])).toBeNull();
  });

  it('names the answer block, which is what the extension filters on', () => {
    expect(answerKindOf(ItemPayloadSchema.parse(item([codeBlock(), editorBlock()])).blocks as Block[])).toBe('codeEditor');
  });
});
