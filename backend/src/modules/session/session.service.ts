import { planSession, remainingDays } from '../../lib/planner.js';
import { toPublicItem } from '../../lib/publicItem.js';
import { localDayFor } from '../../lib/today.js';
import { newCard, toDbCard } from '../../scheduler/index.js';
import { CorrectionSchema, type SessionResponse } from '@learnos/shared';
import { getDueItems } from '../due/due.service.js';
import { findUserById } from '../users/users.repository.js';
import {
  findActiveTopic,
  findConceptsWithCards,
  findItemsForConcepts,
  findPrereqEdges,
  isSessionComplete,
  markSessionComplete,
  teachConcepts,
} from './session.repository.js';

export class SessionError extends Error {
  constructor(
    public readonly reason: 'no_active_topic' | 'not_offered' | 'missing_teaching',
    message: string,
  ) {
    super(message);
    this.name = 'SessionError';
  }
}

type ConceptRow = Awaited<ReturnType<typeof findConceptsWithCards>>[number];

/**
 * Which concepts the learner is ready for: never held out, not already taught,
 * and every prerequisite either taught or already known from the diagnostic.
 *
 * Teaching something whose foundation is missing is the failure mastery gating
 * exists to prevent (plan.md §3.2), so the prereq check is not advisory.
 */
function readyConcepts(rows: ConceptRow[], edges: { conceptId: string; prerequisiteConceptId: string }[]) {
  const taught = new Set(rows.filter((r) => r.taughtAt !== null).map((r) => r.id));
  const prereqs = new Map<string, string[]>();
  for (const edge of edges) {
    prereqs.set(edge.conceptId, [...(prereqs.get(edge.conceptId) ?? []), edge.prerequisiteConceptId]);
  }

  return rows.filter(
    (row) =>
      !row.heldOut &&
      row.taughtAt === null &&
      (prereqs.get(row.id) ?? []).every((id) => taught.has(id)),
  );
}

/**
 * Today's plan, recomputed rather than stored.
 *
 * Both endpoints go through this so they agree exactly: `complete` verifies a
 * concept against the same slice `GET /session` offered, which is what makes
 * the offer checkable without persisting it. Checking against *all* ready
 * concepts instead — an earlier version of this — let a client post every id in
 * the topic and mark the whole course taught.
 */
async function buildPlan(userId: string, now: Date) {
  const topic = await findActiveTopic(userId);
  if (!topic) throw new SessionError('no_active_topic', 'no active topic for this user');

  const [rows, edges, user] = await Promise.all([
    findConceptsWithCards(userId, topic.id),
    findPrereqEdges(topic.id),
    findUserById(userId),
  ]);

  const ready = readyConcepts(rows, edges);
  // Ask for the cap rather than the planned count: the planner needs to know
  // how many are actually due before it can decide how many fit.
  const due = await getDueItems(userId, 50, now);

  const plan = planSession({
    readyCount: ready.length,
    dueCount: due.items.length,
    remainingDays: remainingDays(topic.endsAt, now),
    budgetMin: topic.dailyBudgetMin ?? 15,
  });

  return { topic, user, due, plan, chosen: ready.slice(0, plan.newConceptCount) };
}

export async function getSession(userId: string, now: Date = new Date()): Promise<SessionResponse> {
  const { topic, user, due, plan, chosen } = await buildPlan(userId, now);
  const itemRows = await findItemsForConcepts(chosen.map((c) => c.id));
  const itemByConcept = new Map(itemRows.map((row) => [row.conceptId, row]));

  const newConcepts = chosen.map((concept) => {
    const item = itemByConcept.get(concept.id);
    // Generation is all-or-nothing per topic (T-007), so a taught concept with
    // no item or no teaching content means something upstream went wrong —
    // better to fail loudly than to render a blank lesson.
    if (!item) throw new SessionError('missing_teaching', `concept ${concept.id} has no items`);
    if (!concept.explanationShort || !concept.explanationLong) {
      throw new SessionError('missing_teaching', `concept ${concept.id} has no teaching content`);
    }
    return {
      conceptId: concept.id,
      title: concept.title,
      teachMode: concept.teachMode ?? 'try_first',
      tryFirstPrompt: concept.tryFirstPrompt,
      explanationShort: concept.explanationShort,
      explanationLong: concept.explanationLong,
      corrections: CorrectionSchema.array().parse(concept.corrections ?? []),
      item: toPublicItem(item),
    };
  });

  return {
    newConcepts,
    dueReviews: due.items.slice(0, plan.reviewCount),
    completedToday: await isSessionComplete(
      userId,
      topic.id,
      localDayFor(now, user?.timezone ?? null),
    ),
  };
}

/**
 * Closes out the day: marks the taught concepts, schedules their first review,
 * and records the completion.
 *
 * Submitted ids are checked against a freshly computed plan. Without that, a
 * client could post every concept id in the topic and mark the whole course
 * taught — skipping the teaching while still counting toward the retention
 * measurement.
 */
export async function completeSession(
  userId: string,
  conceptIds: string[],
  now: Date = new Date(),
): Promise<{ completedToday: true; taught: number }> {
  const { topic, user, chosen } = await buildPlan(userId, now);
  console.log('[completeSession] buildPlan result', {
    topicId: topic.id,
    topicStatus: topic.status,
    userId,
    chosenConceptIds: chosen.map((c) => c.id),
    chosenCount: chosen.length,
    timezone: user?.timezone ?? null,
  });
  const offered = new Set(chosen.map((c) => c.id));
  const unknown = conceptIds.filter((id) => !offered.has(id));
  if (unknown.length > 0) {
    throw new SessionError('not_offered', `not offered today: ${unknown.join(', ')}`);
  }

  // due = now so the extension can ask about it later the same day.
  const card = toDbCard(newCard(now));
  console.log('[completeSession] before teachConcepts', {
    userId,
    conceptIds,
    due: card.due,
    taughtAt: now,
  });

  await teachConcepts(
    userId,
    conceptIds.map((conceptId) => ({ conceptId, due: card.due, taughtAt: now })),
  );

  await markSessionComplete(userId, topic.id, localDayFor(now, user?.timezone ?? null));
  console.log('[completeSession] after teachConcepts and session complete', {
    userId,
    topicId: topic.id,
    day: localDayFor(now, user?.timezone ?? null),
    cardDue: card.due,
    taughtCount: conceptIds.length,
  });
  return { completedToday: true, taught: conceptIds.length };
}
