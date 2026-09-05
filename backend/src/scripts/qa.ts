/**
 * `pnpm qa <topicId>` · `pnpm qa:apply <file>` · `pnpm qa:retire <itemId>`
 *
 * Plan (T-024):
 * 1. Export every concept — teaching content (T-053) and every item *including
 *    answer keys* — to `qa/<topic>.md` with a checkbox per concept.
 * 2. Each editable value sits between `<!-- learnos:field ... -->` markers that
 *    carry the row's uuid, so an edited heading still maps to the right row.
 * 3. `qa:apply` parses the whole file, re-validates every item payload against
 *    ItemPayloadSchema, and only then writes — in one transaction, updating
 *    only rows that actually differ.
 * 4. `qa:retire` raises `flagged_bad` past RETIRED_FLAG_THRESHOLD, which the
 *    due queue filters on.
 *
 * An exported file contains every answer key for a live topic. `qa/` is
 * gitignored: committing one would hand a pilot participant the measurement.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { db, pg } from '../db/client.js';
import { concepts, items, topics } from '../db/schema.js';
import { RETIRED_FLAG_THRESHOLD } from '../lib/retire.js';
import { ItemPayloadSchema, type ItemPayload } from '../shared/index.js';

/** Anything the founder did wrong in the file, or that would corrupt a row. */
export class QaError extends Error {}

const BACKEND_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const QA_DIR = join(BACKEND_ROOT, 'qa');

const MARKER = '<!-- learnos:';
const FIELD_END = '<!-- /learnos:field -->';
const FIELD_START = /^<!-- learnos:field (concept|item)=([0-9a-fA-F-]{36}) name=([a-zA-Z]+) -->$/;
const TOPIC_MARKER = /^<!-- learnos:topic ([0-9a-fA-F-]{36}) -->$/;

const CONCEPT_FIELDS = ['title', 'summary', 'tryFirstPrompt', 'explanationShort', 'explanationLong'] as const;
const ITEM_FIELDS = ['prompt', 'answer', 'accept', 'options', 'answerIndex', 'rubric'] as const;

type ConceptField = (typeof CONCEPT_FIELDS)[number];
type ItemField = (typeof ITEM_FIELDS)[number];

// ---------- export ----------

interface ConceptRow {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  order: number;
  heldOut: boolean;
  teachMode: 'try_first' | 'example_first' | null;
  tryFirstPrompt: string | null;
  explanationShort: string | null;
  explanationLong: string | null;
  corrections: unknown;
}

interface ItemRow {
  id: string;
  conceptId: string;
  payload: unknown;
  isTransfer: boolean;
  flaggedBad: number;
}

function field(kind: 'concept' | 'item', id: string, name: string, value: string): string {
  // A value that contained a marker line would swallow the rest of the file on
  // the way back in. It has never happened; if it ever does, fail here rather
  // than write a file that cannot be applied.
  if (value.split('\n').some((line) => line.trimStart().startsWith(MARKER))) {
    throw new QaError(`${kind} ${id} field ${name} contains a learnos marker and cannot be exported`);
  }
  return `<!-- learnos:field ${kind}=${id} name=${name} -->\n${value}\n${FIELD_END}\n`;
}

function renderItem(row: ItemRow, index: number): string {
  const payload = ItemPayloadSchema.parse(row.payload);
  const flags = [payload.type, row.isTransfer ? 'transfer' : null, row.flaggedBad >= RETIRED_FLAG_THRESHOLD ? '**RETIRED**' : null]
    .filter(Boolean)
    .join(' · ');

  let out = `#### Item ${index} · ${flags}\n\n`;
  out += `\`itemId: ${row.id}\`\n\n`;
  out += `**Prompt**\n\n${field('item', row.id, 'prompt', payload.prompt)}\n`;

  if (payload.type === 'recognition') {
    const options = payload.options.map((option, i) => `${i + 1}. ${option}`).join('\n');
    out += `**Options**\n\n${field('item', row.id, 'options', options)}\n`;
    out += `**Correct option (1-${payload.options.length})**\n\n${field('item', row.id, 'answerIndex', String(payload.answerIndex + 1))}\n`;
  } else if (payload.type === 'explain') {
    out += `**Rubric**\n\n${field('item', row.id, 'rubric', payload.rubric)}\n`;
  } else {
    out += `**Answer key**\n\n${field('item', row.id, 'answer', payload.answer)}\n`;
    out += `**Also accepted** (one per line, may be empty)\n\n${field('item', row.id, 'accept', (payload.accept ?? []).join('\n'))}\n`;
  }
  return out;
}

function renderConcept(concept: ConceptRow, conceptItems: ItemRow[]): string {
  let out = `## ${concept.order} · ${concept.title}${concept.heldOut ? '  — HELD OUT' : ''}\n\n`;
  out += `<!-- learnos:concept ${concept.id} -->\n`;
  out += `- [ ] reviewed\n\n`;
  out += `\`slug: ${concept.slug}\` · teach mode: \`${concept.teachMode ?? 'unset'}\`\n\n`;

  if (concept.heldOut) {
    // The control group the pilot's result rests on (plan.md §6): never taught,
    // never reviewed, seen only in a test. Its items still need QA — they are
    // scored on Day 30 — but there is no teaching content to check.
    out += `> **Held out.** Never taught and never reviewed; these items appear only in the Day-30/45 tests. There is no teaching content by design.\n\n`;
  }

  out += `### Title\n\n${field('concept', concept.id, 'title', concept.title)}\n`;
  if (concept.summary !== null) out += `### Summary\n\n${field('concept', concept.id, 'summary', concept.summary)}\n`;
  if (concept.tryFirstPrompt !== null) {
    out += `### Try-first prompt\n\n${field('concept', concept.id, 'tryFirstPrompt', concept.tryFirstPrompt)}\n`;
  }
  if (concept.explanationShort !== null) {
    out += `### Explanation — short\n\n${field('concept', concept.id, 'explanationShort', concept.explanationShort)}\n`;
  }
  if (concept.explanationLong !== null) {
    out += `### Explanation — long\n\n${field('concept', concept.id, 'explanationLong', concept.explanationLong)}\n`;
  }

  // Read-only: a wrong correction is a regeneration, not a text edit (T-063).
  const corrections = Array.isArray(concept.corrections) ? concept.corrections : [];
  if (corrections.length > 0) {
    out += `### Common misconceptions (read-only)\n\n`;
    for (const correction of corrections as { wrong?: string; why?: string }[]) {
      out += `- **${correction.wrong ?? ''}** — ${correction.why ?? ''}\n`;
    }
    out += `\n`;
  }

  out += `### Items (${conceptItems.length})\n\n`;
  if (conceptItems.length === 0) out += `_No items._\n\n`;
  conceptItems.forEach((item, index) => {
    out += renderItem(item, index + 1);
  });
  return `${out}---\n\n`;
}

export function renderExport(
  topic: { id: string; title: string },
  conceptRows: ConceptRow[],
  itemRows: ItemRow[],
): string {
  const byConcept = new Map<string, ItemRow[]>();
  for (const item of itemRows) {
    byConcept.set(item.conceptId, [...(byConcept.get(item.conceptId) ?? []), item]);
  }

  let out = `# Content QA — ${topic.title}\n\n`;
  out += `<!-- learnos:topic ${topic.id} -->\n\n`;
  out += `> **This file contains every answer key for a live topic.** \`qa/\` is gitignored — do not commit it, and do not share it with a pilot participant.\n\n`;
  out += `Generated ${new Date().toISOString()} · ${conceptRows.length} concepts · ${itemRows.length} items.\n\n`;
  out += `**How to use.** Work through \`docs/qa-checklist.md\`. Edit the text between the \`<!-- learnos:field ... -->\` and \`<!-- /learnos:field -->\` markers, leaving the markers themselves alone — they carry the row id, so an edited title still lands on the right row. Tick a concept's checkbox when you have reviewed it. Then:\n\n`;
  out += `\`\`\`\npnpm qa:apply qa/<this-file>.md\n\`\`\`\n\n`;
  out += `Applying an unedited file changes nothing. To drop a bad question entirely: \`pnpm qa:retire <itemId>\`.\n\n---\n\n`;

  for (const concept of conceptRows) {
    out += renderConcept(concept, byConcept.get(concept.id) ?? []);
  }
  return out;
}

export function topicFileName(topic: { id: string; title: string }): string {
  const slug = topic.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'topic';
  // The id suffix keeps two learners' same-titled topics from overwriting each
  // other's export.
  return `${slug}-${topic.id.slice(0, 8)}.md`;
}

export async function exportTopic(
  topicId: string,
  outDir: string = QA_DIR,
): Promise<{ path: string; concepts: number; items: number }> {
  const [topic] = await db.select().from(topics).where(eq(topics.id, topicId));
  if (!topic) throw new QaError(`no topic ${topicId}`);

  const conceptRows = (await db
    .select()
    .from(concepts)
    .where(eq(concepts.topicId, topicId))
    .orderBy(asc(concepts.order))) as ConceptRow[];

  const conceptIds = conceptRows.map((row) => row.id);
  const itemRows =
    conceptIds.length === 0
      ? []
      : ((await db.select().from(items).where(inArray(items.conceptId, conceptIds))) as ItemRow[]);

  const markdown = renderExport(topic, conceptRows, itemRows);
  const path = join(outDir, topicFileName(topic));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path, markdown, 'utf8');
  return { path, concepts: conceptRows.length, items: itemRows.length };
}

// ---------- parse ----------

export interface ParsedEdits {
  topicId: string | null;
  conceptFields: Map<string, Map<ConceptField, string>>;
  itemFields: Map<string, Map<ItemField, string>>;
}

/**
 * Strict on purpose: an unparseable file must abort before anything is written,
 * so the founder never has to work out which half of their edits landed.
 */
export function parseExport(markdown: string): ParsedEdits {
  const lines = markdown.split('\n');
  const result: ParsedEdits = { topicId: null, conceptFields: new Map(), itemFields: new Map() };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const topicMatch = TOPIC_MARKER.exec(line.trim());
    if (topicMatch?.[1]) {
      result.topicId = topicMatch[1];
      continue;
    }

    if (!line.trimStart().startsWith(`${MARKER}field`)) continue;

    const match = FIELD_START.exec(line.trim());
    if (!match) throw new QaError(`line ${i + 1}: malformed field marker: ${line.trim()}`);
    const [, kind, id, name] = match as unknown as [string, 'concept' | 'item', string, string];

    const value: string[] = [];
    let closed = false;
    for (i += 1; i < lines.length; i += 1) {
      const body = lines[i] ?? '';
      if (body.trim() === FIELD_END) {
        closed = true;
        break;
      }
      if (body.trimStart().startsWith(MARKER)) {
        throw new QaError(`line ${i + 1}: field ${kind}=${id} name=${name} was never closed with ${FIELD_END}`);
      }
      value.push(body);
    }
    if (!closed) throw new QaError(`field ${kind}=${id} name=${name} was never closed with ${FIELD_END}`);

    const allowed: readonly string[] = kind === 'concept' ? CONCEPT_FIELDS : ITEM_FIELDS;
    if (!allowed.includes(name)) throw new QaError(`unknown ${kind} field "${name}" for ${id}`);

    const bucket = kind === 'concept' ? result.conceptFields : result.itemFields;
    const fields = bucket.get(id) ?? new Map();
    if (fields.has(name)) throw new QaError(`${kind} ${id} has two "${name}" fields`);
    // Leading/trailing blank lines are formatting, not content; the interior is
    // kept verbatim so a multi-paragraph explanation survives the round trip.
    fields.set(name, value.join('\n').replace(/^\s*\n+/, '').replace(/\n+\s*$/, '').trim());
    bucket.set(id, fields);
  }

  if (result.conceptFields.size === 0 && result.itemFields.size === 0) {
    throw new QaError('no learnos:field markers found — is this a qa export?');
  }
  return result;
}

// ---------- apply ----------

function requireText(value: string | undefined, what: string): string | undefined {
  if (value === undefined) return undefined;
  if (value.trim() === '') throw new QaError(`${what} is empty — edit the text, or use pnpm qa:retire to drop an item`);
  return value;
}

function buildPayload(itemId: string, stored: unknown, edits: Map<ItemField, string>): ItemPayload {
  const payload = ItemPayloadSchema.parse(stored);
  const prompt = requireText(edits.get('prompt'), `item ${itemId} prompt`) ?? payload.prompt;

  if (payload.type === 'recognition') {
    let options = payload.options;
    const edited = edits.get('options');
    if (edited !== undefined) {
      const parsed = edited
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .map((line, index) => {
          const match = /^(\d+)\.\s+(.*)$/.exec(line);
          if (!match || Number(match[1]) !== index + 1) {
            throw new QaError(`item ${itemId}: options must stay numbered "1. …" through "4. …"`);
          }
          return match[2] ?? '';
        });
      if (parsed.length !== 4) throw new QaError(`item ${itemId}: expected 4 options, got ${parsed.length}`);
      options = parsed as typeof payload.options;
    }

    let answerIndex = payload.answerIndex;
    const editedIndex = edits.get('answerIndex');
    if (editedIndex !== undefined) {
      const n = Number(editedIndex.trim());
      if (!Number.isInteger(n) || n < 1 || n > 4) {
        throw new QaError(`item ${itemId}: correct option must be a number 1-4, got "${editedIndex.trim()}"`);
      }
      answerIndex = n - 1;
    }
    return { ...payload, prompt, options, answerIndex };
  }

  if (payload.type === 'explain') {
    return { ...payload, prompt, rubric: requireText(edits.get('rubric'), `item ${itemId} rubric`) ?? payload.rubric };
  }

  const answer = requireText(edits.get('answer'), `item ${itemId} answer`) ?? payload.answer;
  let accept = payload.accept;
  const editedAccept = edits.get('accept');
  if (editedAccept !== undefined) {
    const parsed = editedAccept
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
    accept = parsed.length > 0 ? parsed : undefined;
  }
  return accept === undefined ? { ...payload, prompt, answer, accept: undefined } : { ...payload, prompt, answer, accept };
}

export interface ApplyResult {
  conceptsUpdated: number;
  itemsUpdated: number;
}

/**
 * Non-destructive and idempotent: everything is parsed and validated before the
 * first write, only rows whose values actually changed are touched, and the
 * writes go in one transaction.
 */
export async function applyEdits(filePath: string): Promise<ApplyResult> {
  let markdown: string;
  try {
    markdown = readFileSync(filePath, 'utf8');
  } catch {
    throw new QaError(`cannot read ${filePath}`);
  }

  const edits = parseExport(markdown);

  const conceptIds = [...edits.conceptFields.keys()];
  const itemIds = [...edits.itemFields.keys()];
  const conceptRows = conceptIds.length
    ? await db.select().from(concepts).where(inArray(concepts.id, conceptIds))
    : [];
  const itemRows = itemIds.length ? await db.select().from(items).where(inArray(items.id, itemIds)) : [];

  const missingConcepts = conceptIds.filter((id) => !conceptRows.some((row) => row.id === id));
  const missingItems = itemIds.filter((id) => !itemRows.some((row) => row.id === id));
  if (missingConcepts.length > 0 || missingItems.length > 0) {
    throw new QaError(
      `file references rows that do not exist: ${[...missingConcepts, ...missingItems].join(', ')}`,
    );
  }

  const conceptUpdates: { id: string; values: Partial<Record<ConceptField, string>> }[] = [];
  for (const row of conceptRows) {
    const fields = edits.conceptFields.get(row.id);
    if (!fields) continue;
    const values: Partial<Record<ConceptField, string>> = {};
    for (const name of CONCEPT_FIELDS) {
      const edited = requireText(fields.get(name), `concept ${row.id} ${name}`);
      // The row's value is what the export wrote; only a real difference is a write.
      if (edited !== undefined && edited !== (row[name] ?? null)) values[name] = edited;
    }
    if (Object.keys(values).length > 0) conceptUpdates.push({ id: row.id, values });
  }

  const itemUpdates: { id: string; payload: ItemPayload }[] = [];
  for (const row of itemRows) {
    const fields = edits.itemFields.get(row.id);
    if (!fields) continue;
    const payload = buildPayload(row.id, row.payload, fields);
    if (JSON.stringify(payload) !== JSON.stringify(ItemPayloadSchema.parse(row.payload))) {
      itemUpdates.push({ id: row.id, payload });
    }
  }

  if (conceptUpdates.length === 0 && itemUpdates.length === 0) {
    return { conceptsUpdated: 0, itemsUpdated: 0 };
  }

  await db.transaction(async (tx) => {
    for (const update of conceptUpdates) {
      await tx.update(concepts).set(update.values).where(eq(concepts.id, update.id));
    }
    for (const update of itemUpdates) {
      await tx.update(items).set({ payload: update.payload }).where(eq(items.id, update.id));
    }
  });

  return { conceptsUpdated: conceptUpdates.length, itemsUpdated: itemUpdates.length };
}

// ---------- retire ----------

/** Raises `flagged_bad` past the retire threshold; never lowers an existing count. */
export async function retireItem(itemId: string): Promise<{ id: string; flaggedBad: number }> {
  const [updated] = await db
    .update(items)
    .set({ flaggedBad: sql`GREATEST(${items.flaggedBad}, ${RETIRED_FLAG_THRESHOLD})` })
    .where(eq(items.id, itemId))
    .returning({ id: items.id, flaggedBad: items.flaggedBad });
  if (!updated) throw new QaError(`no item ${itemId}`);
  return updated;
}

// ---------- cli ----------

const USAGE = `usage:
  pnpm qa <topicId>          export a topic to qa/<topic>.md
  pnpm qa:apply <file>       read edits back into the database
  pnpm qa:retire <itemId>    stop serving one item`;

async function main(): Promise<void> {
  const [command, argument] = process.argv.slice(2);
  if (!command || !argument) {
    console.error(USAGE);
    process.exit(1);
  }

  if (command === 'export') {
    const result = await exportTopic(argument);
    console.log(`wrote ${result.path} — ${result.concepts} concepts, ${result.items} items (contains answer keys; do not commit)`);
    return;
  }
  if (command === 'apply') {
    const result = await applyEdits(argument);
    console.log(
      result.conceptsUpdated + result.itemsUpdated === 0
        ? 'no changes'
        : `updated ${result.conceptsUpdated} concepts and ${result.itemsUpdated} items`,
    );
    return;
  }
  if (command === 'retire') {
    const result = await retireItem(argument);
    console.log(`retired item ${result.id} (flagged_bad = ${result.flaggedBad}) — it will not be served again`);
    return;
  }
  console.error(USAGE);
  process.exit(1);
}

// Only when run as a script: importing this module (the tests do) must not run
// a command and close the shared pool underneath the rest of the suite.
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  try {
    await main();
  } catch (error) {
    // A QaError is the founder's mistake, reported as one line; anything else is
    // ours and keeps its stack. Either way: non-zero, and nothing written.
    console.error(error instanceof QaError ? `qa: ${error.message}` : error);
    await pg.end();
    process.exit(1);
  }
  await pg.end();
}
