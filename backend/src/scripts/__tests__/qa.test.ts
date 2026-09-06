import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../app.js';
import { db } from '../../db/client.js';
import { cards, concepts, items, topics, users } from '../../db/schema.js';
import { truncateAll } from '../../test/db.js';
import { applyEdits, exportTopic, parseExport, QaError, renderDomainSplit, retireItem } from '../qa.js';

const app = createApp();

/** A topic with one taught concept, one held-out concept, and one item of each
 *  shape the payload union allows. */
async function seedTopic() {
  const [user] = await db.insert(users).values({ email: `qa-${Date.now()}@example.com` }).returning();
  if (!user) throw new Error('no user');
  const [topic] = await db
    .insert(topics)
    .values({ userId: user.id, title: 'React Hooks', status: 'active' })
    .returning();
  if (!topic) throw new Error('no topic');

  const [taught, heldOut] = await db
    .insert(concepts)
    .values([
      {
        topicId: topic.id,
        slug: 'usestate',
        title: 'useState basics',
        summary: 'State that survives a re-render.',
        order: 1,
        heldOut: false,
        teachMode: 'try_first' as const,
        tryFirstPrompt: 'Why does the screen not update?',
        explanationShort: 'useState stores a value across renders.',
        explanationLong: 'Calling useState(0) returns [value, setValue].\n\nReact keeps the value outside the function.',
        corrections: [{ wrong: 'state updates immediately', why: 'React batches and re-renders' }],
        // T-082 — two different domains, so the export's split is a spread
        // rather than a single value the assertions could pass by accident on.
        domain: 'code' as const,
      },
      {
        topicId: topic.id,
        slug: 'use-reducer',
        title: 'useReducer',
        summary: 'Held-out control concept.',
        order: 2,
        heldOut: true,
        domain: 'prose' as const,
      },
    ])
    .returning();
  if (!taught || !heldOut) throw new Error('no concepts');

  const inserted = await db
    .insert(items)
    .values([
      {
        conceptId: taught.id,
        type: 'recall' as const,
        payload: {
          type: 'recall',
          prompt: 'What does useState return?',
          answer: 'an array with the value and a setter',
          accept: ['[value, setValue]'],
        },
        isTransfer: false,
      },
      {
        conceptId: taught.id,
        type: 'recognition' as const,
        payload: {
          type: 'recognition',
          prompt: 'Why are state updates asynchronous?',
          options: ['React repaints first', 'React batches updates', 'They never update', 'Only in classes'],
          answerIndex: 1,
        },
        isTransfer: false,
      },
      {
        conceptId: taught.id,
        type: 'explain' as const,
        payload: { type: 'explain', prompt: 'Explain the setter.', rubric: 'Mentions re-render scheduling.' },
        isTransfer: true,
      },
      {
        conceptId: heldOut.id,
        type: 'recall' as const,
        payload: { type: 'recall', prompt: 'What does useReducer return?', answer: '[state, dispatch]' },
        isTransfer: false,
      },
    ])
    .returning();

  return { user, topic, taught, heldOut, items: inserted };
}

function outDir() {
  return mkdtempSync(join(tmpdir(), 'learnos-qa-'));
}

/** Every field the round trip is supposed to preserve, as one comparable blob. */
async function snapshot(topicId: string) {
  const conceptRows = await db.select().from(concepts).where(eq(concepts.topicId, topicId));
  const itemRows = await Promise.all(
    conceptRows.map((row) => db.select().from(items).where(eq(items.conceptId, row.id))),
  );
  return JSON.stringify({
    concepts: conceptRows.map((c) => [c.id, c.title, c.summary, c.tryFirstPrompt, c.explanationShort, c.explanationLong, c.corrections]),
    items: itemRows.flat().map((i) => [i.id, i.payload, i.isTransfer, i.flaggedBad]),
  });
}

/** Replaces the text inside one field marker, the way the founder would. */
function edit(markdown: string, kind: 'concept' | 'item', id: string, name: string, value: string): string {
  const start = `<!-- learnos:field ${kind}=${id} name=${name} -->`;
  const index = markdown.indexOf(start);
  expect(index, `${kind} field ${name} for ${id} is in the export`).toBeGreaterThan(-1);
  const from = index + start.length;
  const to = markdown.indexOf('<!-- /learnos:field -->', from);
  return `${markdown.slice(0, from)}\n${value}\n${markdown.slice(to)}`;
}

beforeEach(async () => {
  await truncateAll();
});

describe('qa export', () => {
  it('exports teaching content and answer keys, and marks held-out concepts', async () => {
    const { topic, taught, heldOut } = await seedTopic();
    const dir = outDir();

    const result = await exportTopic(topic.id, dir);
    const markdown = readFileSync(result.path, 'utf8');

    expect(result.concepts).toBe(2);
    expect(result.items).toBe(4);

    // Teaching content (T-053).
    expect(markdown).toContain('Why does the screen not update?');
    expect(markdown).toContain('Calling useState(0) returns [value, setValue].');
    expect(markdown).toContain('state updates immediately');

    // Answer keys — this file is the one place they are written to disk.
    expect(markdown).toContain('an array with the value and a setter');
    expect(markdown).toContain('[value, setValue]');
    expect(markdown).toContain('Mentions re-render scheduling.');
    expect(markdown).toMatch(/name=answerIndex -->\n2\n/);

    // The held-out concept is exported with its items, clearly marked, and with
    // no teaching content to review.
    expect(markdown).toContain('HELD OUT');
    expect(markdown).toContain('What does useReducer return?');
    expect(markdown).not.toContain(`concept=${heldOut.id} name=tryFirstPrompt`);
    expect(markdown).toContain(`concept=${taught.id} name=tryFirstPrompt`);

    // One reviewable checkbox per concept.
    expect(markdown.match(/^- \[ \] reviewed$/gm)).toHaveLength(2);
  });

  // T-082 — docs/qa-checklist.md now asks the founder to check the domain split
  // before anything else, so the export has to show it. A checklist item the
  // tool cannot support is a dead checklist item.
  it('shows each concept’s domain and the topic-level split', async () => {
    const { topic } = await seedTopic();
    const { path } = await exportTopic(topic.id, outDir());
    const markdown = readFileSync(path, 'utf8');

    expect(markdown).toContain('**Domain split.**');
    expect(markdown).toContain('domain: `code`');
    expect(markdown).toContain('domain: `prose`');
  });

  it('flags a topic that is under a third prose, and stays quiet on a healthy spread', () => {
    const rows = (domains: (string | null)[]) =>
      domains.map((domain, i) => ({
        id: `${i}`,
        slug: `c${i}`,
        title: `C${i}`,
        summary: null,
        order: i,
        heldOut: false,
        teachMode: null,
        domain,
        tryFirstPrompt: null,
        explanationShort: null,
        explanationLong: null,
        corrections: [],
      })) as Parameters<typeof renderDomainSplit>[0];

    // The failure this catches: every concept classified by subject.
    expect(renderDomainSplit(rows(['code', 'code', 'code', 'code']))).toContain('under a third prose');
    expect(renderDomainSplit(rows(['code', 'code', 'prose', 'prose']))).not.toContain('under a third');
    // Percentages, because 9 of 23 reads very differently from 9 of 40.
    expect(renderDomainSplit(rows(['code', 'prose', 'prose', 'systems']))).toContain('prose 2 (50%)');
    expect(renderDomainSplit(rows([null, null, 'prose', 'prose']))).toContain('unset 2');
  });

  it('names the file after the topic and writes it into the qa directory', async () => {
    const { topic } = await seedTopic();
    const dir = outDir();

    const result = await exportTopic(topic.id, dir);

    expect(readdirSync(dir)).toEqual([`react-hooks-${topic.id.slice(0, 8)}.md`]);
    expect(result.path).toBe(join(dir, `react-hooks-${topic.id.slice(0, 8)}.md`));
  });

  it('refuses an unknown topic', async () => {
    await expect(exportTopic('11111111-1111-4111-8111-111111111111', outDir())).rejects.toBeInstanceOf(QaError);
  });
});

describe('qa apply', () => {
  it('round trips: an edited explanation lands, and nothing else moves', async () => {
    const { topic, taught } = await seedTopic();
    const dir = outDir();
    const { path } = await exportTopic(topic.id, dir);
    const before = await snapshot(topic.id);

    const edited = edit(
      readFileSync(path, 'utf8'),
      'concept',
      taught.id,
      'explanationShort',
      'useState hands the component a value React keeps for it.',
    );
    writeFileSync(path, edited, 'utf8');

    const result = await applyEdits(path);
    expect(result).toEqual({ conceptsUpdated: 1, itemsUpdated: 0 });

    const [row] = await db.select().from(concepts).where(eq(concepts.id, taught.id));
    expect(row?.explanationShort).toBe('useState hands the component a value React keeps for it.');

    // Everything else is untouched: the only difference from the snapshot is
    // the field we edited.
    const after = await snapshot(topic.id);
    expect(after).toBe(before.replace('useState stores a value across renders.', 'useState hands the component a value React keeps for it.'));
  });

  it('applies an edited answer key, and a multi-paragraph explanation survives verbatim', async () => {
    const { topic, taught, items: seeded } = await seedTopic();
    const recall = seeded[0];
    if (!recall) throw new Error('no recall item');
    const dir = outDir();
    const { path } = await exportTopic(topic.id, dir);

    let markdown = readFileSync(path, 'utf8');
    markdown = edit(markdown, 'item', recall.id, 'answer', 'a two-element array: the value and its setter');
    markdown = edit(markdown, 'item', recall.id, 'accept', '[value, setValue]\nthe value and a setter');
    writeFileSync(path, markdown, 'utf8');

    expect(await applyEdits(path)).toEqual({ conceptsUpdated: 0, itemsUpdated: 1 });

    const [row] = await db.select().from(items).where(eq(items.id, recall.id));
    expect(row?.payload).toEqual({
      type: 'recall',
      prompt: 'What does useState return?',
      answer: 'a two-element array: the value and its setter',
      accept: ['[value, setValue]', 'the value and a setter'],
    });

    const [concept] = await db.select().from(concepts).where(eq(concepts.id, taught.id));
    expect(concept?.explanationLong).toBe(
      'Calling useState(0) returns [value, setValue].\n\nReact keeps the value outside the function.',
    );
  });

  it('applying an unedited export changes nothing at all', async () => {
    const { topic } = await seedTopic();
    const dir = outDir();
    const { path } = await exportTopic(topic.id, dir);
    const before = await snapshot(topic.id);

    expect(await applyEdits(path)).toEqual({ conceptsUpdated: 0, itemsUpdated: 0 });

    expect(await snapshot(topic.id)).toBe(before);
  });

  it('maps an edited title back by id, not by heading text', async () => {
    const { topic, taught } = await seedTopic();
    const dir = outDir();
    const { path } = await exportTopic(topic.id, dir);

    let markdown = readFileSync(path, 'utf8');
    markdown = edit(markdown, 'concept', taught.id, 'title', 'useState, from scratch');
    // The founder also retitled the heading and reordered nothing else; the
    // heading is decoration, the marker is the anchor.
    markdown = markdown.replace('## 1 · useState basics', '## 1 · something else entirely');
    writeFileSync(path, markdown, 'utf8');

    expect(await applyEdits(path)).toEqual({ conceptsUpdated: 1, itemsUpdated: 0 });

    const [row] = await db.select().from(concepts).where(eq(concepts.id, taught.id));
    expect(row?.title).toBe('useState, from scratch');
    expect(row?.slug).toBe('usestate');
  });

  it('aborts without writing when the file is malformed', async () => {
    const { topic } = await seedTopic();
    const dir = outDir();
    const { path } = await exportTopic(topic.id, dir);
    const before = await snapshot(topic.id);

    const broken = readFileSync(path, 'utf8')
      .replace('useState stores a value across renders.\n<!-- /learnos:field -->', 'an edit whose closing marker was deleted');
    writeFileSync(path, broken, 'utf8');

    await expect(applyEdits(path)).rejects.toBeInstanceOf(QaError);
    expect(await snapshot(topic.id)).toBe(before);
  });

  it('aborts on an out-of-range correct option rather than storing it', async () => {
    const { topic, items: seeded } = await seedTopic();
    const recognition = seeded[1];
    if (!recognition) throw new Error('no recognition item');
    const dir = outDir();
    const { path } = await exportTopic(topic.id, dir);
    const before = await snapshot(topic.id);

    writeFileSync(path, edit(readFileSync(path, 'utf8'), 'item', recognition.id, 'answerIndex', '9'), 'utf8');

    await expect(applyEdits(path)).rejects.toBeInstanceOf(QaError);
    expect(await snapshot(topic.id)).toBe(before);
  });

  it('renumbers a corrected option list and keeps four options', async () => {
    const { topic, items: seeded } = await seedTopic();
    const recognition = seeded[1];
    if (!recognition) throw new Error('no recognition item');
    const dir = outDir();
    const { path } = await exportTopic(topic.id, dir);

    const markdown = edit(
      readFileSync(path, 'utf8'),
      'item',
      recognition.id,
      'options',
      '1. React repaints first\n2. React batches updates and schedules a re-render\n3. They never update\n4. Only in classes',
    );
    writeFileSync(path, markdown, 'utf8');
    expect(await applyEdits(path)).toEqual({ conceptsUpdated: 0, itemsUpdated: 1 });

    const [row] = await db.select().from(items).where(eq(items.id, recognition.id));
    expect(row?.payload).toMatchObject({
      options: ['React repaints first', 'React batches updates and schedules a re-render', 'They never update', 'Only in classes'],
      answerIndex: 1,
    });

    // Three options is not a multiple-choice question; the payload schema is
    // what says so, and apply must not get past it.
    writeFileSync(path, edit(readFileSync(path, 'utf8'), 'item', recognition.id, 'options', '1. a\n2. b\n3. c'), 'utf8');
    await expect(applyEdits(path)).rejects.toBeInstanceOf(QaError);
  });

  it('aborts when the file references a row that no longer exists', async () => {
    const { topic, heldOut } = await seedTopic();
    const dir = outDir();
    const { path } = await exportTopic(topic.id, dir);

    await db.delete(items).where(eq(items.conceptId, heldOut.id));
    await db.delete(concepts).where(eq(concepts.id, heldOut.id));

    await expect(applyEdits(path)).rejects.toBeInstanceOf(QaError);
  });

  it('rejects a file that is not a qa export', async () => {
    expect(() => parseExport('# just some notes\n\nnothing anchored here')).toThrow(QaError);
  });
});

describe('qa retire', () => {
  it('excludes a retired item from GET /due', async () => {
    const { user, topic, taught, items: seeded } = await seedTopic();
    // Only the recall item is answerable in the due queue for this concept; the
    // others are here so retiring one still leaves the concept servable.
    await db.delete(items).where(eq(items.id, seeded[1]!.id));
    await db.delete(items).where(eq(items.id, seeded[2]!.id));
    const recall = seeded[0]!;

    const taughtAt = new Date(Date.now() - 2 * 86_400_000);
    await db.insert(cards).values({
      userId: user.id,
      conceptId: taught.id,
      due: new Date(Date.now() - 86_400_000),
      taughtAt,
      stability: 2,
      difficulty: 5,
      reps: 1,
      state: 2,
      lastReview: taughtAt,
    });

    const before = await request(app).get('/due?limit=10').set('x-user-id', user.id);
    expect(before.status).toBe(200);
    expect(before.body.items.map((i: { itemId: string }) => i.itemId)).toContain(recall.id);

    const retired = await retireItem(recall.id);
    expect(retired.flaggedBad).toBeGreaterThanOrEqual(3);

    const after = await request(app).get('/due?limit=10').set('x-user-id', user.id);
    expect(after.status).toBe(200);
    expect(after.body.items.map((i: { itemId: string }) => i.itemId)).not.toContain(recall.id);
    expect(topic.status).toBe('active');
  });

  it('never lowers an existing flag count, and refuses an unknown item', async () => {
    const { items: seeded } = await seedTopic();
    const item = seeded[0]!;
    await db.update(items).set({ flaggedBad: 7 }).where(eq(items.id, item.id));

    expect((await retireItem(item.id)).flaggedBad).toBe(7);
    await expect(retireItem('11111111-1111-4111-8111-111111111111')).rejects.toBeInstanceOf(QaError);
  });
});
