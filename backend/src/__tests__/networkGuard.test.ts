import { describe, expect, it } from 'vitest';

/**
 * Proves the guard in vitest.setup.ts is armed.
 *
 * Without it, a suite that forgets to mock a generator makes a *live* call and
 * fails with a provider 401 — which reads as a credentials problem rather than
 * a missing mock. That happened twice before this existed (T-FIX-009).
 */
describe('network guard', () => {
  it('blocks outbound HTTP with a message naming the fix', async () => {
    await expect(fetch('https://api.openai.com/v1/chat/completions')).rejects.toThrow(
      /Network call blocked in tests/,
    );
  });

  it('names the SDK boundary to mock', async () => {
    await expect(fetch('https://example.com')).rejects.toThrow(/vi\.mock\('openai'/);
  });

  it('does not hand tests the real API key', () => {
    expect(process.env.OPENAI_API_KEY).toBe('test-key-never-used');
  });

  it('leaves mail on the console transport', () => {
    // A suite that forgot to stub the transport must not be able to email a learner.
    expect(process.env.SMTP_HOST).toBe('');
  });
});
