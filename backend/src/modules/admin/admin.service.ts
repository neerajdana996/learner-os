import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { concepts, reviewEvents, topics, users } from '../../db/schema.js';
import type { AdminReport, AdminRow } from '@learnos/shared';
import {
  calibrationGapDelta,
  durability,
  extensionStats,
  retentionGain,
  schedulerCalibration,
  teachModeComparison,
  transfer,
} from '../../lib/metrics.js';

/** The shape is defined once, in `@learnos/shared`, and the client reads the
 *  same definition — see T-075 on hand-written response types. */
export type { AdminReport, AdminRow } from '@learnos/shared';

/**
 * Every participant × topic, plus cohort means (T-041).
 *
 * One row per pair rather than per user: a learner on two topics has two
 * independent measurements, and averaging them into one person-shaped number
 * would hide the case this pilot is most likely to find — that it works on one
 * kind of material and not another.
 */
export async function buildReport(): Promise<AdminReport> {
  const pairs = await db
    .select({
      userId: users.id,
      email: users.email,
      topicId: topics.id,
      topicTitle: topics.title,
    })
    .from(topics)
    .innerJoin(users, eq(topics.userId, users.id))
    .orderBy(asc(users.email), asc(topics.title));

  const rows: AdminRow[] = [];
  for (const pair of pairs) {
    const [gain, dur, tr, cal, ext, modes, bins] = await Promise.all([
      retentionGain(pair.userId, pair.topicId),
      durability(pair.userId, pair.topicId),
      transfer(pair.userId, pair.topicId),
      calibrationGapDelta(pair.userId, pair.topicId),
      extensionStats(pair.userId),
      teachModeComparison(pair.userId),
      schedulerCalibration(pair.userId),
    ]);

    rows.push({
      ...pair,
      retentionGain: gain.gain,
      taughtDelta: gain.taught,
      heldOutDelta: gain.heldOut,
      durability: dur,
      transfer: tr,
      calibrationGapDelta: cal,
      extension: ext,
      teachMode: modes,
      calibration: bins,
    });
  }

  return { rows, cohort: cohortOf(rows) };
}

/**
 * Means over the rows that actually have a number.
 *
 * **Nulls are excluded, not counted as zero**, for the same reason `metrics.ts`
 * returns them: a participant who has not sat Day-45 has no durability, and
 * folding a zero in would report a collapse that never happened. Every mean
 * therefore ships with its own `n`.
 */
function cohortOf(rows: AdminRow[]): AdminReport['cohort'] {
  const mean = (values: (number | null)[]) => {
    const present = values.filter((v): v is number => v !== null);
    if (present.length === 0) return { value: null, n: 0 };
    const sum = present.reduce((a, b) => a + b, 0);
    return { value: Math.round((sum / present.length) * 10_000) / 10_000, n: present.length };
  };

  const gain = mean(rows.map((r) => r.retentionGain));
  const dur = mean(rows.map((r) => r.durability));
  const tr = mean(rows.map((r) => r.transfer));
  const cal = mean(rows.map((r) => r.calibrationGapDelta));
  const ans = mean(rows.map((r) => r.extension.answerRate));

  return {
    n: { retentionGain: gain.n, durability: dur.n, transfer: tr.n, calibrationGapDelta: cal.n, answerRate: ans.n },
    retentionGain: gain.value,
    durability: dur.value,
    transfer: tr.value,
    calibrationGapDelta: cal.value,
    answerRate: ans.value,
  };
}

export const CSV_HEADER = [
  'event_id',
  'user_id',
  'concept_id',
  'concept_slug',
  'held_out',
  'item_id',
  'correct',
  'confidence',
  'predicted_recall',
  'gap_days_since_last',
  'latency_ms',
  'surface',
  'snoozed',
  'dismissed',
  'assisted',
  'created_at',
] as const;

/**
 * Every review on one topic, as CSV (T-041).
 *
 * The dashboard answers the questions I thought to ask; this is for the ones I
 * did not. `concept_slug` and `held_out` are joined in so the file stands alone
 * in a spreadsheet — a column of UUIDs is not analysable by a human.
 *
 * **No answer text and no prompt.** This file will be opened on a laptop, mailed
 * to a co-founder, and left in a downloads folder; it holds what happened, not
 * what was said.
 */
export async function reviewsCsv(topicId: string): Promise<string> {
  const topicConcepts = await db
    .select({ id: concepts.id })
    .from(concepts)
    .where(eq(concepts.topicId, topicId));

  const ids = topicConcepts.map((c) => c.id);
  if (ids.length === 0) return `${CSV_HEADER.join(',')}\n`;

  const rows = await db
    .select({
      id: reviewEvents.id,
      userId: reviewEvents.userId,
      conceptId: reviewEvents.conceptId,
      slug: concepts.slug,
      heldOut: concepts.heldOut,
      itemId: reviewEvents.itemId,
      correct: reviewEvents.correct,
      confidence: reviewEvents.confidence,
      predictedRecall: reviewEvents.predictedRecall,
      gapDaysSinceLast: reviewEvents.gapDaysSinceLast,
      latencyMs: reviewEvents.latencyMs,
      surface: reviewEvents.surface,
      snoozed: reviewEvents.snoozed,
      dismissed: reviewEvents.dismissed,
      assisted: reviewEvents.assisted,
      createdAt: reviewEvents.createdAt,
    })
    .from(reviewEvents)
    .innerJoin(concepts, eq(reviewEvents.conceptId, concepts.id))
    .where(and(inArray(reviewEvents.conceptId, ids)))
    .orderBy(asc(reviewEvents.createdAt));

  const body = rows.map((r) =>
    [
      r.id,
      r.userId,
      r.conceptId,
      cell(r.slug),
      r.heldOut,
      r.itemId ?? '',
      r.correct ?? '',
      r.confidence ?? '',
      r.predictedRecall,
      r.gapDaysSinceLast ?? '',
      r.latencyMs ?? '',
      r.surface,
      r.snoozed,
      r.dismissed,
      r.assisted,
      r.createdAt.toISOString(),
    ].join(','),
  );

  return `${CSV_HEADER.join(',')}\n${body.map((line) => `${line}\n`).join('')}`;
}

/**
 * Quotes a value that would otherwise break the row.
 *
 * Only the slug can contain anything interesting, but a slug with a comma in it
 * would silently shift every column after it — and a shifted column is a wrong
 * analysis rather than a broken file, which is much worse.
 */
function cell(value: string): string {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}
