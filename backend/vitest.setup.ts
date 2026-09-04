// Runs before every test file. Points the app at the test database so no test
// can ever touch `learnos`. T-002 adds truncateAll()/seedUser() on top of this.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://learnos:learnos@localhost:5432/learnos_test';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'test-key-never-used';
