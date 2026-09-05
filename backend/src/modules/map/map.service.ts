import { scoreConcept, topicScore } from '../../lib/score.js';
import type { MapResponse } from '../../shared/index.js';
import { findEdges, findMapRows, findOwnedTopic } from './map.repository.js';

export class MapError extends Error {
  constructor(public readonly reason: 'topic_not_found') {
    super('topic not found');
    this.name = 'MapError';
  }
}

export async function getMap(
  userId: string,
  topicId: string,
  now: Date = new Date(),
): Promise<MapResponse> {
  const topic = await findOwnedTopic(topicId, userId);
  if (!topic) throw new MapError('topic_not_found');

  const [rows, edges] = await Promise.all([findMapRows(userId, topicId), findEdges(topicId)]);

  const estimates =
    (topic.diagnosticState as { estimates?: Record<string, number> } | null)?.estimates ?? {};

  const scored = rows.map((row) =>
    scoreConcept(
      {
        id: row.id,
        order: row.order,
        heldOut: row.heldOut,
        // A left join with no card leaves every column null; `due` standing in
        // for "is there a card" keeps that check in one place.
        card: row.due
          ? {
              due: row.due,
              stability: row.stability ?? 0,
              difficulty: row.difficulty ?? 0,
              elapsedDays: row.elapsedDays ?? 0,
              scheduledDays: row.scheduledDays ?? 0,
              reps: row.reps ?? 0,
              lapses: row.lapses ?? 0,
              state: row.state ?? 0,
              lastReview: row.lastReview,
              taughtAt: row.taughtAt,
            }
          : null,
        diagnosticEstimate: estimates[row.id],
      },
      now,
    ),
  );

  const titleById = new Map(rows.map((row) => [row.id, row.title]));

  return {
    topicId: topic.id,
    title: topic.title,
    score: topicScore(scored),
    // Built field by field, and the title is attached only for concepts that
    // are not held out — the same fail-closed construction as `toPublicItem`
    // (T-010). Deleting a key instead would leak the moment someone adds a new
    // field to the row and forgets this line.
    concepts: scored.map((concept) => ({
      conceptId: concept.conceptId,
      title: concept.state === 'heldout' ? null : (titleById.get(concept.conceptId) ?? null),
      order: concept.order,
      state: concept.state,
      mastery: concept.mastery,
      atRisk: concept.atRisk,
    })),
    // Edges are kept for held-out concepts: the shape of the graph is not the
    // secret, only what the node is called.
    edges,
  };
}
