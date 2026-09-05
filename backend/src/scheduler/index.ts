// Thin wrapper around ts-fsrs (v4.7.1). Card scheduling is server-only —
// never imported from frontend/extension.
import { fsrs, createEmptyCard, generatorParameters, Rating, type Card, type Grade } from 'ts-fsrs';

export { Rating };
export type { Grade };

// No personalised parameters for the pilot (plan.md §8): one shared engine
// with FSRS defaults. enable_fuzz is already false by default; set explicitly
// so scheduling stays deterministic in tests without relying on that default.
export function createEngine(params: Parameters<typeof generatorParameters>[0] = {}) {
  return fsrs(generatorParameters({ enable_fuzz: false, ...params }));
}

const defaultEngine = createEngine();

// DB row shape for the `cards` table (plan.md §5: "cards (FSRS state per
// user×concept, taughtAt)"). The `cards` table itself doesn't exist yet
// (T-049); whoever builds it should match these field names/types, or update
// toDbCard/fromDbCard to match the real schema.
export interface DbCard {
  due: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview: Date | null;
}

export function toDbCard(card: Card): DbCard {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.last_review ?? null,
  };
}

export function fromDbCard(row: DbCard): Card {
  return {
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsedDays,
    scheduled_days: row.scheduledDays,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    last_review: row.lastReview ?? undefined,
  };
}

export function newCard(now: Date = new Date()): Card {
  return createEmptyCard(now);
}

export function scheduleReview(card: Card, rating: Grade, now: Date, engine = defaultEngine): Card {
  return engine.next(card, now, rating).card;
}

// Retrievability just before the given time, i.e. what FSRS believes right
// now — always in [0, 1]. 0 for a card that's never been reviewed (state New,
// handled internally by ts-fsrs).
export function predictedRecall(card: Card, now: Date = new Date(), engine = defaultEngine): number {
  return engine.get_retrievability(card, now, false);
}
