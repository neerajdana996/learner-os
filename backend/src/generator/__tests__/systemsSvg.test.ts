import { describe, expect, it } from 'vitest';
import { BlockGenerationSchema, BlockSchema, ItemGenerationSchema, toPublicBlock, type Block } from '@learnos/shared';
import { renderDiagram, renderSequence } from '../systemsSvg.js';
import { toItemPayload } from '../blocks.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const PROMPTS = join(import.meta.dirname, '../../llm/prompts/items/domains');

const nodes = [
  { id: 'client', label: 'Client' },
  { id: 'primary', label: 'Primary' },
  { id: 'replica', label: 'Replica' },
];
const edges = [
  { from: 'client', to: 'primary', label: 'write' },
  { from: 'primary', to: 'replica', label: 'replicate' },
  { from: 'replica', to: 'client', label: 'stale read' },
];

describe('renderDiagram', () => {
  it('draws a box per node and an arrow per edge', () => {
    const svg = renderDiagram(nodes, edges);
    expect(svg.match(/<rect /g)).toHaveLength(3);
    expect(svg.match(/<path d="M /g)).toHaveLength(3);
    expect(svg).toContain('Primary');
  });

  /**
   * The five token names come from `packages/ui/styles/_code-palette.scss`. A
   * literal here would be a light-mode diagram burned into the database — the
   * SVG is stored once and rendered in whichever theme the reader is using.
   */
  it('uses theme tokens, never literal colours', () => {
    const svg = renderDiagram(nodes, edges);
    expect(svg).toContain('var(--node-fill)');
    expect(svg).toContain('var(--edge)');
    expect(svg).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  it('drops an edge naming a node that does not exist rather than drawing to nowhere', () => {
    // The schema validates each field, not the reference between them, so this
    // is where a dangling edge surfaces.
    const svg = renderDiagram(nodes, [{ from: 'client', to: 'ghost' }]);
    expect(svg).not.toContain('<path d="M ');
  });

  it('escapes label text', () => {
    const svg = renderDiagram([{ id: 'a', label: '<script>' }, { id: 'b', label: 'B' }], []);
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).not.toContain('<script>');
  });
});

describe('renderSequence', () => {
  const lanes = ['Client', 'Primary'];
  const messages = [
    { from: 'Client', to: 'Primary', label: 'write x=1' },
    { from: 'Primary', to: 'Client', label: 'stale x=0', delayed: true },
  ];

  it('draws a lifeline per lane and an arrow per message', () => {
    const svg = renderSequence(lanes, messages);
    expect(svg.match(/<line x1=/g)?.length).toBeGreaterThanOrEqual(4); // 2 lifelines + 2 messages
    expect(svg).toContain('stale x=0');
  });

  it('slopes and dashes a delayed message — that is the whole bug', () => {
    const svg = renderSequence(lanes, messages);
    expect(svg).toContain('stroke-dasharray');
    expect(svg).toContain('var(--edge-focus)');
  });
});

describe('the systems blocks end to end', () => {
  const generated = {
    type: 'recognition' as const,
    prompt: 'Which read can return a stale value?',
    options: ['a', 'b', 'c', 'd'],
    answerIndex: 1,
    isTransfer: false,
    blocks: [{ kind: 'sequence' as const, slot: 'context' as const, lanes: ['Client', 'Replica'], messages: [{ from: 'Client', to: 'Replica', label: 'read', delayed: null }, { from: 'Replica', to: 'Client', label: 'x=0', delayed: true }], alt: 'A client reads from a replica and gets a stale value.' }],
  };

  it('refuses an svg from the model, then adds one in the worker', () => {
    // `.strict()` on the generation form is what makes "the model cannot emit
    // markup" a property of the code rather than a promise in a prompt.
    const withSvg = { ...generated.blocks[0], svg: '<svg onload="alert(1)"/>' };
    expect(BlockGenerationSchema.safeParse(withSvg).success).toBe(false);

    const payload = toItemPayload(ItemGenerationSchema.parse(generated)) as { blocks: Block[] };
    const stored = BlockSchema.parse(payload.blocks[0]);
    expect(stored.kind).toBe('sequence');
    expect('svg' in stored && stored.svg).toContain('<svg');
  });

  it('sends the drawing to the client but not the data to redraw it', () => {
    const payload = toItemPayload(ItemGenerationSchema.parse(generated)) as { blocks: Block[] };
    const pub = toPublicBlock(BlockSchema.parse(payload.blocks[0]));
    // Shipping both would be shipping the diagram twice — once as a picture and
    // once as the data for the graph library this design exists to avoid.
    expect(pub).toMatchObject({ kind: 'sequence', alt: expect.any(String) });
    expect(pub).not.toHaveProperty('lanes');
    expect(pub).not.toHaveProperty('messages');
  });

  it('never sends the numeric answer key to the client', () => {
    const block = BlockSchema.parse({ kind: 'numeric', slot: 'answer', answer: 6e9, tolerance: 0.5, unit: 'bytes' });
    const pub = toPublicBlock(block);
    expect(pub).toEqual({ kind: 'numeric', slot: 'answer', unit: 'bytes' });
    expect(pub).not.toHaveProperty('answer');
    expect(pub).not.toHaveProperty('tolerance');
  });

  it('holds a diagram to five nodes, so every one is extension-safe by construction', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, label: `N${i}` }));
    const block = { kind: 'diagram', slot: 'context', nodes: six, edges: [{ from: 'n0', to: 'n1', label: null }], alt: 'six' };
    expect(BlockGenerationSchema.safeParse(block).success).toBe(false);
  });

  it('keeps numeric in the answer slot and the drawings out of it', () => {
    expect(BlockGenerationSchema.safeParse({ kind: 'numeric', slot: 'context', answer: 1, tolerance: 0, unit: null }).success).toBe(false);
    expect(BlockGenerationSchema.safeParse({ kind: 'diagram', slot: 'answer', nodes, edges, alt: 'x' }).success).toBe(false);
  });
});

describe('domainFragment', () => {
  it('selects the fragment that exists for each domain', async () => {
    const { domainFragment } = await import('../items.js');
    expect(domainFragment('code')).toBe('code');
    expect(domainFragment('systems')).toBe('systems');
  });

  /**
   * `loadTemplate` treats a missing fragment as a deliberate no-op, so naming a
   * domain here before its file exists would silently hand it the generic
   * prompt while the code claimed otherwise. `math` is designed but unwritten
   * (T-109), so it must stay absent.
   */
  it('does not name a domain whose fragment has not been written', () => {
    expect(existsSync(join(PROMPTS, 'systems.md'))).toBe(true);
    expect(existsSync(join(PROMPTS, 'math.md'))).toBe(false);
  });

  it('falls back to the generic prompt for prose and for nothing at all', async () => {
    const { domainFragment } = await import('../items.js');
    expect(domainFragment('prose')).toBeUndefined();
    expect(domainFragment(undefined)).toBeUndefined();
  });
});

describe('self-messages', () => {
  /**
   * "Node B → Node B: receive, then forward" is a standard sequence idiom and
   * the generator reaches for it unprompted — it produced two of them in the
   * first real distributed-systems topic. Dropped, they took half that diagram
   * with them and nothing said so.
   */
  it('draws a message from a lane to itself as a loop', () => {
    const svg = renderSequence(['A', 'B'], [{ from: 'B', to: 'B', label: 'process' }]);
    expect(svg).toContain('process');
    expect(svg).toContain('h 22');
  });

  it('still drops a message naming a lane that does not exist', () => {
    const svg = renderSequence(['A', 'B'], [{ from: 'A', to: 'ghost', label: 'x' }]);
    expect(svg).not.toContain('>x<');
  });
});

describe('canvas sizing', () => {
  it('widens for a self-message on the last lane, so its label is not clipped', () => {
    const plain = renderSequence(['A', 'B'], [{ from: 'A', to: 'B', label: 'x' }]);
    const looped = renderSequence(['A', 'B'], [{ from: 'B', to: 'B', label: 'a long label here' }]);
    const w = (svg: string) => Number(/viewBox="0 0 (\d+)/.exec(svg)?.[1]);
    expect(w(looped)).toBeGreaterThan(w(plain));
  });

  it('carries its natural size rather than stretching to the container', () => {
    // width="100%" scaled a 414px drawing across an 800px column and doubled
    // every label. The stylesheet caps it instead.
    const svg = renderSequence(['A', 'B'], [{ from: 'A', to: 'B', label: 'x' }]);
    expect(svg).not.toContain('width="100%"');
    expect(svg).toMatch(/width="\d+" height="\d+"/);
  });
});
