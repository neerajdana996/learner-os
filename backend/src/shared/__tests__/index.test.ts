import { describe, it, expect } from 'vitest';
import { TopicCreateSchema, WsClientMessageSchema, AnswerSchema, ItemPayloadSchema } from '../index.js';

describe('shared schemas', () => {
  it('TopicCreateSchema parses a valid object with just a title', () => {
    const parsed = TopicCreateSchema.parse({ title: 'React Hooks' });
    expect(parsed).toEqual({ title: 'React Hooks', dailyBudgetMin: 15 });
  });

  it('TopicCreateSchema rejects an empty title', () => {
    expect(TopicCreateSchema.safeParse({ title: '' }).success).toBe(false);
  });

  it('TopicCreateSchema rejects a 6-day span, accepts 7', () => {
    const startsAt = '2026-01-01T00:00:00.000Z';
    const sixDays = TopicCreateSchema.safeParse({
      title: 'React Hooks',
      startsAt,
      endsAt: '2026-01-07T00:00:00.000Z',
    });
    const sevenDays = TopicCreateSchema.safeParse({
      title: 'React Hooks',
      startsAt,
      endsAt: '2026-01-08T00:00:00.000Z',
    });
    expect(sixDays.success).toBe(false);
    expect(sevenDays.success).toBe(true);
  });

  // T-091 — the learner picks the language.
  it('TopicCreateSchema accepts a language, and the same body without one', () => {
    const withLanguage = TopicCreateSchema.safeParse({ title: 'Dynamic programming', language: 'Python' });
    expect(withLanguage.success && withLanguage.data.language).toBe('Python');

    // Back-compat with the payload onboarding already sends: absent is a real
    // answer ("doesn't matter"), not a validation failure.
    const without = TopicCreateSchema.safeParse({ title: 'Dynamic programming' });
    expect(without.success && without.data.language).toBeUndefined();
  });

  it('TopicCreateSchema rejects a language over 40 characters', () => {
    expect(TopicCreateSchema.safeParse({ title: 'Dynamic programming', language: 'x'.repeat(40) }).success).toBe(true);
    expect(TopicCreateSchema.safeParse({ title: 'Dynamic programming', language: 'x'.repeat(41) }).success).toBe(false);
    // An empty string is not "doesn't matter" — that is the field being absent.
    expect(TopicCreateSchema.safeParse({ title: 'Dynamic programming', language: '' }).success).toBe(false);
  });

  it('TopicCreateSchema rejects dailyBudgetMin 4 and 31', () => {
    expect(TopicCreateSchema.safeParse({ title: 'React Hooks', dailyBudgetMin: 4 }).success).toBe(false);
    expect(TopicCreateSchema.safeParse({ title: 'React Hooks', dailyBudgetMin: 31 }).success).toBe(false);
    expect(TopicCreateSchema.safeParse({ title: 'React Hooks', dailyBudgetMin: 5 }).success).toBe(true);
    expect(TopicCreateSchema.safeParse({ title: 'React Hooks', dailyBudgetMin: 30 }).success).toBe(true);
  });

  it('WsClientMessageSchema accepts ping and rejects unknown types', () => {
    expect(WsClientMessageSchema.safeParse({ type: 'ping' }).success).toBe(true);
    expect(WsClientMessageSchema.safeParse({ type: 'nope' }).success).toBe(false);
  });

  it('AnswerSchema requires confidence to be one of guess/think/sure or null', () => {
    const base = { itemId: '11111111-1111-1111-1111-111111111111', surface: 'web' as const };
    expect(AnswerSchema.safeParse({ ...base, confidence: 'guess' }).success).toBe(true);
    expect(AnswerSchema.safeParse({ ...base, confidence: 'think' }).success).toBe(true);
    expect(AnswerSchema.safeParse({ ...base, confidence: 'sure' }).success).toBe(true);
    expect(AnswerSchema.safeParse({ ...base, confidence: null }).success).toBe(true);
    expect(AnswerSchema.safeParse({ ...base, confidence: 'positive' }).success).toBe(false);
    expect(AnswerSchema.safeParse({ ...base }).success).toBe(false);
  });

  it('ItemPayloadSchema for recognition requires exactly 4 options and answerIndex in 0..3', () => {
    const base = { type: 'recognition' as const, prompt: 'Which one?' };
    expect(
      ItemPayloadSchema.safeParse({ ...base, options: ['a', 'b', 'c', 'd'], answerIndex: 0 }).success,
    ).toBe(true);
    expect(
      ItemPayloadSchema.safeParse({ ...base, options: ['a', 'b', 'c'], answerIndex: 0 }).success,
    ).toBe(false);
    expect(
      ItemPayloadSchema.safeParse({ ...base, options: ['a', 'b', 'c', 'd'], answerIndex: 4 }).success,
    ).toBe(false);
  });

  it('ItemPayloadSchema for recall requires non-empty answer', () => {
    expect(
      ItemPayloadSchema.safeParse({ type: 'recall', prompt: 'What is a hook?', answer: 'A function' })
        .success,
    ).toBe(true);
    expect(
      ItemPayloadSchema.safeParse({ type: 'recall', prompt: 'What is a hook?', answer: '' }).success,
    ).toBe(false);
  });
});
