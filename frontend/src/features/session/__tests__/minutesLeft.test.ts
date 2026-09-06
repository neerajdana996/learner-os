import { describe, expect, it } from 'vitest';
import { minutesLeft } from '../pages/SessionPage';

describe('minutesLeft', () => {
  it('uses the same weights the server planned the session with', () => {
    // lib/planner.ts: 180s per new concept, 45s per review. A number that
    // disagreed with the budget the session was built to would be worse than
    // no number.
    expect(minutesLeft(1, 0)).toBe(3);
    expect(minutesLeft(0, 4)).toBe(3);
    expect(minutesLeft(2, 6)).toBe(11);
  });

  it('never says zero minutes while there is still work', () => {
    expect(minutesLeft(0, 0)).toBe(1);
    expect(minutesLeft(0, 1)).toBe(1);
  });
});
