import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocked at the SDK boundary, same as conceptMap.test.ts, so the real
// complete() → stripFences → JSON.parse → Zod → rule-validation path runs.
const create = vi.fn();
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create } };
  },
}));

const { generateItems, validateItems, GenerationError } = await import('../items.js');
const { collectWarnings } = await import('../severity.js');

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures');
const fixtureText = readFileSync(join(fixtures, 'items.usestate.json'), 'utf8');
const fixture = JSON.parse(fixtureText);
/** T-083 — a real-looking code concept: 8 items, 2 rich, 1 transfer. */
const codeFixtureText = readFileSync(join(fixtures, 'items.binary-search-bound.json'), 'utf8');

const asText = (text: string, finishReason = 'stop') => ({
  choices: [{ message: { content: text }, finish_reason: finishReason }],
});

/** Item generation speaks in batches now (T-162). These fixtures are one
 *  concept, so wrap them in the envelope the model would actually return —
 *  `generateItems` sends a batch of one under the slug `concept`. */
const asBatch = (json: string) =>
  JSON.stringify({ concepts: [{ slug: 'concept', items: JSON.parse(json).items }] });


beforeEach(() => create.mockReset());

// T-083 — the fixture is the acceptance criterion made runnable: it has to
// survive the whole pipeline, including the block resolution and every
// superRefine rule T-080 wrote.
describe('the code-item fixture', () => {
  const generate = () =>
    generateItems({
      topic: 'Binary search',
      concept: 'Exclusive upper bound',
      summary: 'hi holds one past the last index.',
      domain: 'code',
    });

  it('parses end to end, with line quotes resolved into line numbers', async () => {
    create.mockResolvedValueOnce(asText(asBatch(codeFixtureText)));
    const result = await generate();

    expect(result.items).toHaveLength(8);
    expect(new Set(result.items.map((i) => i.payload.type))).toEqual(
      new Set(['recall', 'recognition', 'application', 'explain']),
    );

    const noted = result.items
      .flatMap((i) => i.payload.blocks ?? [])
      .find((b): b is Extract<typeof b, { kind: 'code' }> => b.kind === 'code' && b.notes.length > 0);
    // "let hi = a.length;" is the third line — resolved from the quote, never
    // sent as a number.
    expect(noted?.notes[0]?.line).toBe(3);
  });

  it('keeps rich formats to two, and the rest plain', async () => {
    create.mockResolvedValueOnce(asText(asBatch(codeFixtureText)));
    const result = await generate();

    const rich = result.items.filter((i) => i.payload.blocks?.some((b) => b.slot === 'answer'));
    expect(rich).toHaveLength(2);
    expect(rich.map((i) => i.payload.blocks?.find((b) => b.slot === 'answer')?.kind).sort()).toEqual([
      'clozeCode',
      'hotspotLine',
    ]);
  });

  it('marks its transfer item plain, not rich', async () => {
    create.mockResolvedValueOnce(asText(asBatch(codeFixtureText)));
    const result = await generate();

    // A blank cut into the listing the concept was taught with is a second
    // attempt, not transfer — and `isTransfer` is a measured outcome.
    const transfer = result.items.filter((i) => i.isTransfer);
    expect(transfer).toHaveLength(1);
    expect(transfer[0]?.payload.blocks).toBeUndefined();
  });

  it('rejects a third rich item rather than storing it', async () => {
    const doc = JSON.parse(codeFixtureText);
    // Turn the plain recall into a third cloze.
    doc.items[0].blocks = [
      {
        kind: 'clozeCode',
        slot: 'answer',
        lang: 'javascript',
        src: 'let hi = a.{{1}};',
        holes: [{ id: 1, answer: 'length', accept: [], width: 6 }],
        failure: 'a.length - 1 skips the last element.',
      },
    ];
    create.mockResolvedValue(asText(asBatch(JSON.stringify(doc))));

    // T-164: the cap is a review-time budget, not a correctness rule, so a
    // third rich item costs a warning rather than the course. It is still
    // checked twice and still repaired-for first — hence two calls.
    const { result, warnings } = await collectWarnings(() => generate());

    expect(result.items).toHaveLength(8);
    expect(create).toHaveBeenCalledTimes(2);
    expect(warnings).toContainEqual(
      expect.objectContaining({ reason: 'too_many_rich', prompt: 'items' }),
    );
  });

  it('retries once when a cloze marker has no matching hole, then succeeds', async () => {
    const broken = JSON.parse(codeFixtureText);
    const cloze = broken.items[2].blocks[1];
    cloze.src = 'while ({{1}} && {{2}}) {';

    create.mockResolvedValueOnce(asText(asBatch(JSON.stringify(broken)))).mockResolvedValueOnce(asText(asBatch(codeFixtureText)));

    const result = await generate();

    expect(result.items).toHaveLength(8);
    expect(create).toHaveBeenCalledTimes(2);
  });
});

describe('items generation', () => {
  it('parses the fixture, which contains all four types and 6+ items', async () => {
    create.mockResolvedValueOnce(asText(asBatch(fixtureText)));
    const result = await generateItems({ topic: 'useState', concept: 'useState', summary: 'what it covers' });
    expect(result.items.length).toBeGreaterThanOrEqual(6);
    expect(new Set(result.items.map((item) => item.payload.type))).toEqual(
      new Set(['recall', 'recognition', 'application', 'explain']),
    );
  });

  // Each case below keeps all four item types present with a valid transfer
  // count (unless that's the property under test) and an explicit isTransfer
  // on every item, so each test isolates exactly the one rule it names.
  it('rejects recognition items with only 3 options', () => {
    const bad = {
      topic: 'useState',
      items: [
        { type: 'recall', prompt: 'Q1', answer: 'A', isTransfer: true },
        { type: 'application', prompt: 'Q2', answer: 'A', isTransfer: false },
        { type: 'explain', prompt: 'Q3', rubric: 'R', isTransfer: false },
        { type: 'recognition', prompt: 'Which one?', options: ['a', 'b', 'c'], distractorSource: 'the nearest wrong belief', answerIndex: 1, isTransfer: false },
      ],
    };

    expect(() => validateItems(bad)).toThrow(GenerationError);
    expect(() => validateItems(bad)).toThrowError(/recognition/i);
  });

  it('rejects zero transfer items', () => {
    const bad = {
      topic: 'useState',
      items: [
        { type: 'recall', prompt: 'What is state?', answer: 'value', accept: ['value'], isTransfer: false },
        { type: 'recognition', prompt: 'Pick', options: ['a', 'b', 'c', 'd'], distractorSource: 'the nearest wrong belief', answerIndex: 0, isTransfer: false },
        { type: 'application', prompt: 'Apply', answer: 'A', isTransfer: false },
        { type: 'explain', prompt: 'Explain', rubric: 'R', isTransfer: false },
      ],
    };

    expect(() => validateItems(bad)).toThrow(GenerationError);
    expect(() => validateItems(bad)).toThrowError(/transfer/i);
  });

  it('rejects three transfer items', () => {
    const bad = {
      topic: 'useState',
      items: [
        { type: 'recall', prompt: 'Q1', answer: 'A', isTransfer: true },
        { type: 'recognition', prompt: 'Q2', options: ['a', 'b', 'c', 'd'], distractorSource: 'the nearest wrong belief', answerIndex: 0, isTransfer: true },
        { type: 'application', prompt: 'Q3', answer: 'A', isTransfer: true },
        { type: 'explain', prompt: 'Q4', rubric: 'R', isTransfer: false },
      ],
    };

    expect(() => validateItems(bad)).toThrow(GenerationError);
    expect(() => validateItems(bad)).toThrowError(/transfer/i);
  });

  it('rejects explanations longer than 200 chars', () => {
    const bad = {
      topic: 'useState',
      items: [
        { type: 'explain', prompt: 'Explain', rubric: 'a'.repeat(201), isTransfer: false },
        { type: 'recall', prompt: 'Q', answer: 'A', accept: ['A'], isTransfer: true },
        { type: 'recognition', prompt: 'Pick', options: ['a', 'b', 'c', 'd'], distractorSource: 'the nearest wrong belief', answerIndex: 0, isTransfer: false },
        { type: 'application', prompt: 'Apply', answer: 'A', isTransfer: false },
      ],
    };

    expect(() => validateItems(bad)).toThrow(GenerationError);
    expect(() => validateItems(bad)).toThrowError(/200|rubric|explain/i);
  });

  /**
   * T-175. "Write a component that increments a counter when a button is
   * clicked." shipped as a plain `application` item: a one-line input
   * captioned "A few words is enough", graded against a whole JSX snippet.
   */
  const withApplicationPrompt = (prompt: string, blocks?: unknown) => ({
    topic: 'useState',
    items: [
      { type: 'application', prompt, isTransfer: false, answer: 'setCount(count + 1)', ...(blocks ? { blocks } : {}) },
      { type: 'recall', prompt: 'Q', answer: 'A', accept: ['A'], isTransfer: true },
      { type: 'recognition', prompt: 'Pick', options: ['a', 'b', 'c', 'd'], distractorSource: 'the nearest wrong belief', answerIndex: 0, isTransfer: false },
      { type: 'explain', prompt: 'Explain', rubric: 'the rubric', isTransfer: false },
    ],
  });

  const codeEditorBlock = [
    {
      kind: 'codeEditor',
      slot: 'answer',
      lang: 'javascript',
      signature: 'Counter()',
      starter: 'function Counter() {\n}',
      skeleton: 'function Counter() {\n  const [count, setCount] = useState(0);\n}',
      whyWhole: 'A blank cannot test that the setter is wired to the click.',
      cases: [
        { name: 'starts at zero', call: 'render(Counter).text', expect: '0' },
        { name: 'increments once', call: 'click().text', expect: '1' },
      ],
    },
  ];

  it('rejects a prompt that asks for code when the item has no codeEditor block', () => {
    const bad = withApplicationPrompt('Write a component that increments a counter when a button is clicked.');

    expect(() => validateItems(bad)).toThrow(GenerationError);
    expect(() => validateItems(bad)).toThrowError(/codeEditor|code_answer_format/i);
  });

  it('accepts the same prompt once it carries a codeEditor block', () => {
    const good = withApplicationPrompt(
      'Write a component that increments a counter when a button is clicked.',
      codeEditorBlock,
    );

    expect(() => validateItems(good)).not.toThrow();
  });

  /** A one-liner is a good plain item: rejecting it would cost a call to catch
   *  nothing. This is the false positive the rule must not have. */
  it('leaves a one-line "write the call" prompt as a plain item', () => {
    const fine = withApplicationPrompt(
      'You have `const [count, setCount] = useState(0)`. Write the call that increments it by one.',
    );

    expect(() => validateItems(fine)).not.toThrow();
  });

  it('rejects a set with fewer than 6 items', async () => {
    // All four types present and exactly one transfer, so every other rule
    // passes and only the count gate can fire.
    const tooFew = {
      topic: 'useState',
      items: [
        { type: 'recall', prompt: 'Q1', answer: 'A', isTransfer: false },
        { type: 'recognition', prompt: 'Q2', options: ['a', 'b', 'c', 'd'], distractorSource: 'the nearest wrong belief', answerIndex: 0, isTransfer: false },
        { type: 'application', prompt: 'Q3', answer: 'A', isTransfer: false },
        { type: 'explain', prompt: 'Q4', rubric: 'R', isTransfer: true },
      ],
    };
    create.mockResolvedValue(asText(asBatch(JSON.stringify(tooFew))));

    // T-164: four items is a thinner rotation, not an unusable concept. The
    // warning names the concept so content QA knows which one to look at.
    const { result, warnings } = await collectWarnings(() =>
      generateItems({ topic: 'useState', concept: 'useState', summary: 'what it covers' }),
    );

    expect(result.items).toHaveLength(4);
    expect(warnings).toContainEqual(
      expect.objectContaining({ reason: 'too_few_items', message: expect.stringContaining('concept') }),
    );
  });

  // The other half of the same rule: a reply nobody could answer still ends the
  // job, however many calls have already succeeded.
  it('still fails the topic on an integrity rule, tolerance or not', async () => {
    const bad = JSON.parse(fixtureText);
    bad.items[0].prompt = 'Which operations overlap in the history shown?';
    delete bad.items[0].blocks;
    create.mockResolvedValue(asText(asBatch(JSON.stringify(bad))));

    await expect(generateItems({ topic: 'useState', concept: 'useState', summary: 'what it covers' })).rejects.toMatchObject({
      name: 'GenerationError',
      reason: 'dangling_reference',
    });
  });

  // T-164: the retry is a correction, not a re-roll. Run 2 of the real flow
  // broke the same rule on both attempts because nothing ever told the model
  // what was wrong with the first one.
  it('sends the rejected reply and the rule it broke back on the retry', async () => {
    // All four types, five items: the only rule it can break is the count, so
    // the assertion below is about the repair turn and not about which rule
    // happened to fire first.
    const short = {
      topic: 'useState',
      items: [
        { type: 'recall', prompt: 'Q1', answer: 'A', accept: [], isTransfer: false },
        { type: 'recognition', prompt: 'Q2', options: ['a', 'b', 'c', 'd'], distractorSource: 'the nearest wrong belief', answerIndex: 0, isTransfer: false },
        { type: 'application', prompt: 'Q3', answer: 'A', accept: [], isTransfer: true },
        { type: 'explain', prompt: 'Q4', rubric: 'R', isTransfer: false },
        { type: 'recall', prompt: 'Q5', answer: 'A', accept: [], isTransfer: false },
      ],
    };
    create
      .mockResolvedValueOnce(asText(asBatch(JSON.stringify(short))))
      .mockResolvedValueOnce(asText(asBatch(fixtureText)));

    await generateItems({ topic: 'useState', concept: 'useState', summary: 'what it covers' });

    const retry = create.mock.calls[1]?.[0] as { messages: { role: string; content: string }[] };
    expect(retry.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    // The assistant turn is the rejected reply itself, verbatim, so the model
    // is correcting its own answer rather than reading a description of it.
    expect(retry.messages[2]?.content).toContain('Q1');
    expect(retry.messages[3]?.content).toMatch(/too_few_items/);
  });

  it('retries once when the first response is not JSON, then resolves', async () => {
    create.mockResolvedValueOnce(asText('here are your questions')).mockResolvedValueOnce(asText(asBatch(fixtureText)));
    await expect(generateItems({ topic: 'useState', concept: 'useState', summary: 'what it covers' })).resolves.toMatchObject({ topic: 'useState' });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('rejects with GenerationError when both attempts fail, without a third call', async () => {
    create.mockResolvedValue(asText('broken'));
    await expect(generateItems({ topic: 'useState', concept: 'useState', summary: 'what it covers' })).rejects.toMatchObject({ name: 'GenerationError' });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('does not retry a truncated response', async () => {
    create.mockResolvedValue(asText('{"topic":"useState","items":[', 'length'));
    await expect(generateItems({ topic: 'useState', concept: 'useState', summary: 'what it covers' })).rejects.toMatchObject({
      name: 'GenerationError',
      reason: 'truncated',
    });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
