import { describe, it, expect } from 'vitest';
import { TopicCreateSchema } from './shared';

// Proves the synced copy of backend/src/shared compiles and runs in the
// extension's (browser) build — no Node-only imports leaked through.
describe('synced shared schemas', () => {
  it('TopicCreateSchema parses a valid object', () => {
    expect(TopicCreateSchema.parse({ title: 'React Hooks' })).toEqual({
      title: 'React Hooks',
      dailyBudgetMin: 15,
    });
  });
});
