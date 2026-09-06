import {
  apply,
  buildGraph,
  calibrationGap,
  initialState,
  isDone,
  KNOWN_THRESHOLD,
  MAX_QUESTIONS,
  next,
  type DiagnosticConcept,
  type DiagnosticState,
} from '../../lib/diagnostic.js';
import { toPublicItem } from '../../lib/publicItem.js';
import { recordReview } from '../../lib/recordReview.js';
import { newCard, Rating, scheduleReview, toDbCard } from '../../scheduler/index.js';
import type { DiagnosticAnswer, DiagnosticNextResponse } from '@learnos/shared';
import { findUserById } from '../users/users.repository.js';
import {
  findConcepts,
  findDiagnosticAnswers,
  findItemForConcept,
  findOwnedTopic,
  findPrereqEdges,
  persistCompletion,
  saveDiagnosticState,
  type CardSeed,
} from './diagnostic.repository.js';

export class DiagnosticError extends Error {
  constructor(
    public readonly reason: 'topic_not_found' | 'no_item' | 'not_started' | 'wrong_concept',
    message: string,
  ) {
    super(message);
    this.name = 'DiagnosticError';
  }
}

async function load(userId: string, topicId: string) {
  const topic = await findOwnedTopic(topicId, userId);
  // 404 rather than 403: a 403 would confirm the topic exists (T-008).
  if (!topic) throw new DiagnosticError('topic_not_found', `topic ${topicId} not found`);

  const rows = await findConcepts(topicId);
  const conceptList: DiagnosticConcept[] = rows.map((r) => ({
    id: r.id,
    order: r.order,
    heldOut: r.heldOut,
  }));
  const graph = buildGraph(await findPrereqEdges(topicId));
  const state = (topic.diagnosticState as DiagnosticState | null) ?? initialState(conceptList);

  return { topic, rows, concepts: conceptList, graph, state };
}

export async function startDiagnostic(userId: string, topicId: string): Promise<DiagnosticNextResponse> {
  const { concepts } = await load(userId, topicId);
  await saveDiagnosticState(topicId, initialState(concepts));
  return nextQuestion(userId, topicId);
}

export async function nextQuestion(userId: string, topicId: string): Promise<DiagnosticNextResponse> {
  const { concepts, graph, state } = await load(userId, topicId);

  if (isDone(state, concepts)) return finish(userId, topicId);

  const conceptId = next(state, concepts, graph);
  if (conceptId === null) return finish(userId, topicId);

  const item = await findItemForConcept(conceptId);
  // A concept with no items can't be asked about. Rather than stalling the
  // whole diagnostic, mark it asked at its current estimate and move on.
  if (!item) {
    const skipped: DiagnosticState = { ...state, asked: [...state.asked, conceptId] };
    await saveDiagnosticState(topicId, skipped);
    return nextQuestion(userId, topicId);
  }

  return {
    done: false,
    conceptId,
    item: toPublicItem(item),
    progress: { asked: state.asked.length, max: MAX_QUESTIONS },
  };
}

export async function answerQuestion(
  userId: string,
  topicId: string,
  answer: DiagnosticAnswer,
  now: Date = new Date(),
): Promise<DiagnosticNextResponse> {
  const { state, graph } = await load(userId, topicId);

  // Graded server-side and recorded with surface='diagnostic', which is what
  // stops it touching the card schedule (T-009). Scheduling here would
  // contaminate the very measurement the diagnostic exists to take.
  const recorded = await recordReview(
    userId,
    {
      itemId: answer.itemId,
      response: answer.response,
      confidence: answer.confidence,
      latencyMs: answer.latencyMs,
      surface: 'diagnostic',
    },
    now,
  );

  const advanced = apply(state, answer.conceptId, recorded.correct === true, graph);
  await saveDiagnosticState(topicId, advanced);
  return nextQuestion(userId, topicId);
}

/**
 * Creates the cards the learner will be scheduled on and records day 0.
 *
 * Concepts estimated at or above KNOWN_THRESHOLD are treated as already known:
 * they get `taughtAt` set so T-016's planner skips teaching them, and their
 * FSRS state is seeded as though they had just answered correctly. That is why
 * there is no `mastery` column — T-017 reads mastery as `predictedRecall(card)`,
 * and a stored copy would immediately drift from it.
 */
async function finish(userId: string, topicId: string): Promise<DiagnosticNextResponse> {
  const { concepts, rows, state } = await load(userId, topicId);
  const now = new Date();

  const teachable = rows.filter((r) => !r.heldOut);
  const seeds: CardSeed[] = teachable.map((row) => {
    const estimate = state.estimates[row.id] ?? 0.5;
    const known = estimate >= KNOWN_THRESHOLD;
    const card = known
      ? scheduleReview(newCard(now), Rating.Good, now)
      : newCard(now);
    return { conceptId: row.id, ...toDbCard(card), taughtAt: known ? now : null };
  });

  const answers = await findDiagnosticAnswers(userId, concepts.map((c) => c.id));
  const graded = answers
    .filter((a) => a.correct !== null)
    .map((a) => ({ confidence: a.confidence, correct: a.correct === true }));

  const gap = calibrationGap(graded);
  const correctCount = graded.filter((a) => a.correct).length;
  const overall = graded.length > 0 ? correctCount / graded.length : 0;

  const user = await findUserById(userId);
  await persistCompletion({
    userId,
    topicId,
    seeds,
    scores: {
      overall,
      calibrationGap: gap,
      perConcept: Object.fromEntries(teachable.map((r) => [r.id, state.estimates[r.id] ?? 0.5])),
    },
    calibrationGap: gap,
    profile: (user?.profile as Record<string, unknown>) ?? {},
  });

  const sure = graded.filter((a) => a.confidence === 'sure');
  return {
    done: true,
    summary: {
      asked: state.asked.length,
      sureCount: sure.length,
      sureCorrectCount: sure.filter((a) => a.correct).length,
    },
  };
}
