// Runs before every test file. Points the app at the test database so no test
// can ever touch `learnos`. T-002 adds truncateAll()/seedUser() on top of this.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://learnos:learnos@localhost:5432/learnos_test';
// Redis database 1, never 0. Postgres is carefully isolated to `learnos_test`,
// but Redis was shared with dev — and three suites call
// `queue.obliterate({ force: true })` in `beforeEach`. Running `pnpm test`
// while a real generation was in flight therefore deleted the running job, and
// left its topic stuck on `generating` with nothing to finish it (T-068).
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1';

// A sentinel, not the real key. `env.ts` calls process.loadEnvFile(), so without
// this the actual key from backend/.env reaches the suite — which is how a test
// that forgot to mock a generator ended up making a live call and failing with
// a 401 instead of an obvious "you forgot to mock this" (T-FIX-009).
process.env.OPENAI_API_KEY = 'test-key-never-used';
process.env.SMTP_HOST = '';

/**
 * No test may reach the network (loop.md §3).
 *
 * Blocked at `fetch` rather than inside the LLM client, because the client is
 * itself mocked in the suites that use it — there is no reliable way from
 * inside to tell a mocked SDK from a real one. This catches every outbound HTTP
 * call: the model API, OAuth providers, anything added later.
 *
 * Postgres, Redis and supertest are unaffected — they use sockets and the HTTP
 * module directly, not `fetch`. A suite that legitimately stubs `fetch`
 * (oauth.test.ts) simply replaces this and restores it afterwards.
 */
const blockedFetch: typeof fetch = async (input) => {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  throw new Error(
    `Network call blocked in tests: ${url}\n` +
      'A generator or provider call is not mocked. Mock the SDK boundary — ' +
      "vi.mock('openai', …) for model calls, or globalThis.fetch for HTTP providers.",
  );
};

globalThis.fetch = blockedFetch;
