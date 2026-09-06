import { describe, it, expect } from 'vitest';
import { TopicCreateSchema } from '@learnos/shared';

// Proves @learnos/shared compiles and runs inside this client's browser build —
// that no Node-only import has leaked into the package. The schemas themselves
// are tested once, in packages/shared; this is only the browser-safety guard
// that scripts/sync-shared.sh used to enforce by grepping.
describe('@learnos/shared is browser-safe here', () => {
  it('parses a topic', () => {
    expect(TopicCreateSchema.parse({ title: 'React Hooks' })).toEqual({
      title: 'React Hooks',
      dailyBudgetMin: 15,
    });
  });
});
