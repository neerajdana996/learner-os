import { describe, it, expect } from 'vitest';
import { TopicCreateSchema, WsClientMessageSchema } from './index.js';

describe('shared schemas', () => {
  it('TopicCreateSchema parses a valid object', () => {
    const parsed = TopicCreateSchema.parse({ title: 'React Hooks' });
    expect(parsed).toEqual({ title: 'React Hooks' });
  });

  it('TopicCreateSchema rejects an empty title', () => {
    expect(TopicCreateSchema.safeParse({ title: '' }).success).toBe(false);
  });

  it('WsClientMessageSchema accepts ping and rejects unknown types', () => {
    expect(WsClientMessageSchema.safeParse({ type: 'ping' }).success).toBe(true);
    expect(WsClientMessageSchema.safeParse({ type: 'nope' }).success).toBe(false);
  });
});
