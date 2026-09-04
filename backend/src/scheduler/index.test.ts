import { describe, it, expect } from 'vitest';
import { newCard, scheduleReview, predictedRecall, toDbCard, fromDbCard, Rating, createEngine } from './index.js';

const engine = createEngine();
const now = new Date('2026-01-01T00:00:00.000Z');
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

describe('scheduler', () => {
  it('newCard() has reps = 0, state = 0, predictedRecall = 0', () => {
    const card = newCard(now);
    expect(card.reps).toBe(0);
    expect(card.state).toBe(0);
    expect(predictedRecall(card, now, engine)).toBe(0);
  });

  it('rating Good on a new card schedules it into the future with reps = 1', () => {
    const card = newCard(now);
    const reviewed = scheduleReview(card, Rating.Good, now, engine);
    expect(reviewed.due.getTime()).toBeGreaterThan(now.getTime());
    expect(reviewed.reps).toBe(1);
  });

  it('rating Again on a reviewed card increments lapses', () => {
    let card = newCard(now);
    card = scheduleReview(card, Rating.Good, now, engine);
    card = scheduleReview(card, Rating.Good, addDays(now, 1), engine);
    expect(card.state).toBe(2); // State.Review
    const lapsesBefore = card.lapses;
    card = scheduleReview(card, Rating.Again, addDays(now, 5), engine);
    expect(card.lapses).toBe(lapsesBefore + 1);
  });

  it('two consecutive Good ratings: second scheduled_days > first', () => {
    let card = newCard(now);
    card = scheduleReview(card, Rating.Good, now, engine);
    const firstScheduledDays = card.scheduled_days;
    card = scheduleReview(card, Rating.Good, addDays(now, 1), engine);
    expect(card.scheduled_days).toBeGreaterThan(firstScheduledDays);
  });

  it('predictedRecall decreases monotonically as now advances', () => {
    let card = newCard(now);
    card = scheduleReview(card, Rating.Good, now, engine);
    card = scheduleReview(card, Rating.Good, addDays(now, 1), engine);

    const at = (days: number) => predictedRecall(card, addDays(now, 1 + days), engine);
    const r0 = at(0);
    const r1 = at(1);
    const r7 = at(7);
    const r30 = at(30);
    expect(r0).toBeGreaterThan(r1);
    expect(r1).toBeGreaterThan(r7);
    expect(r7).toBeGreaterThan(r30);
  });

  it('fromDbCard(toDbCard(card)) deep-equals card', () => {
    let card = newCard(now);
    card = scheduleReview(card, Rating.Good, now, engine);
    expect(fromDbCard(toDbCard(card))).toEqual(card);
  });
});
