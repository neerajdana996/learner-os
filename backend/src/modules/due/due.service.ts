import { toPublicItem } from '../../lib/publicItem.js';
import type { DueItemsResponse } from '../../shared/index.js';
import { findCandidates, findDueCards, findRecentHistory, RECENT_WINDOW } from './due.repository.js';

export async function getDueItems(
  userId: string,
  limit: number,
  now: Date = new Date(),
): Promise<DueItemsResponse> {
  const dueCards = await findDueCards(userId, now, limit);
  if (dueCards.length === 0) return { items: [] };

  const conceptIds = dueCards.map((card) => card.conceptId);
  const [candidates, history] = await Promise.all([
    findCandidates(conceptIds),
    findRecentHistory(userId, conceptIds),
  ]);

  const recentByConcept = new Map<string, string[]>();
  for (const row of history) {
    const seen = recentByConcept.get(row.conceptId) ?? [];
    if (seen.length < RECENT_WINDOW && row.itemId) {
      seen.push(row.itemId);
      recentByConcept.set(row.conceptId, seen);
    }
  }

  const byConcept = new Map<string, typeof candidates>();
  for (const item of candidates) {
    byConcept.set(item.conceptId, [...(byConcept.get(item.conceptId) ?? []), item]);
  }

  const payload: DueItemsResponse = { items: [] };
  for (const card of dueCards) {
    const pool = byConcept.get(card.conceptId) ?? [];
    if (pool.length === 0) continue;
    const recent = new Set(recentByConcept.get(card.conceptId) ?? []);
    const unseen = pool.filter((item) => !recent.has(item.id));
    const chosen = (unseen.length > 0 ? unseen : pool)[0];
    if (chosen) payload.items.push(toPublicItem(chosen));
  }
  return payload;
}