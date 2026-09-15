import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createLogger, requestLogging, type LogLevel } from '../log.js';

/** A logger whose lines land in an array instead of the console. */
function capture() {
  const lines: { level: LogLevel; entry: Record<string, unknown> }[] = [];
  const logger = createLogger(
    (level, line) => lines.push({ level, entry: JSON.parse(line) as Record<string, unknown> }),
    () => new Date('2026-09-15T10:00:00Z'),
  );
  return { lines, logger };
}

describe('createLogger (T-047)', () => {
  it('writes one JSON object per line: time, level, event, then fields', () => {
    const { lines, logger } = capture();
    logger.info('something_happened', { topicId: 't1', count: 3 });

    expect(lines).toEqual([
      {
        level: 'info',
        entry: { time: '2026-09-15T10:00:00.000Z', level: 'info', event: 'something_happened', topicId: 't1', count: 3 },
      },
    ]);
  });

  /** A credential in a log line is a credential in every place logs are copied to. */
  it('redacts credential-looking fields at any depth', () => {
    const { lines, logger } = capture();
    logger.warn('careful', {
      token: 'raw-token',
      nested: { password: 'hunter2', headers: { authorization: 'Bearer x', cookie: 'learnos_session=y' } },
      list: [{ apiKey: 'sk-live' }],
      harmless: 'kept',
    });

    const text = JSON.stringify(lines[0]?.entry);
    for (const secret of ['raw-token', 'hunter2', 'Bearer x', 'learnos_session=y', 'sk-live']) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain('kept');
  });

  /** drizzle puts the driver's real error in `cause`; losing it made 500s a black box (T-154). */
  it('serialises an error with its message, stack and cause', () => {
    const { lines, logger } = capture();
    logger.error('failed', { error: new Error('outer', { cause: new Error('ECONNRESET') }) });

    const error = lines[0]?.entry.error as { message: string; stack: string; cause: { message: string } };
    expect(error.message).toBe('outer');
    expect(error.stack).toContain('outer');
    expect(error.cause.message).toBe('ECONNRESET');
  });

  it('survives a field that cannot be serialised', () => {
    const { lines, logger } = capture();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => logger.info('cyclic', { cyclic: { a: { b: { c: { d: { e: { f: { g: cyclic } } } } } } } })).not.toThrow();
    expect(lines[0]?.entry.event).toBe('cyclic');
  });
});

describe('requestLogging (T-047)', () => {
  function appWith(logger: ReturnType<typeof capture>['logger']) {
    const app = express();
    app.use(requestLogging(logger));
    app.get('/health', (_req, res) => {
      res.json({ ok: true });
    });
    app.get('/auth/verify', (_req, res) => {
      res.status(401).json({ error: 'invalid_token' });
    });
    app.get('/boom', (_req, res) => {
      res.status(500).json({ error: 'internal' });
    });
    return app;
  }

  it('tags the response with an id and logs the request against it', async () => {
    const { lines, logger } = capture();
    const res = await request(appWith(logger)).get('/auth/verify');

    const requestId = res.headers['x-request-id'];
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.entry).toMatchObject({ event: 'http_request', requestId, method: 'GET', path: '/auth/verify', status: 401 });
  });

  /** A sign-in token rides in the query string; the path never carries it. */
  it('logs the path and never the query string', async () => {
    const { lines, logger } = capture();
    await request(appWith(logger)).get('/auth/verify?token=live-sign-in-token');

    expect(lines[0]?.entry.path).toBe('/auth/verify');
    expect(JSON.stringify(lines)).not.toContain('live-sign-in-token');
  });

  it('reuses a well-formed inbound request id and replaces a malformed one', async () => {
    const { logger } = capture();
    const app = appWith(logger);

    const kept = await request(app).get('/auth/verify').set('X-Request-Id', 'edge-1234abcd');
    expect(kept.headers['x-request-id']).toBe('edge-1234abcd');

    const replaced = await request(app).get('/auth/verify').set('X-Request-Id', 'bad id <script>');
    expect(replaced.headers['x-request-id']).not.toBe('bad id <script>');
  });

  it('logs a 5xx at error level', async () => {
    const { lines, logger } = capture();
    await request(appWith(logger)).get('/boom');
    expect(lines[0]?.level).toBe('error');
  });

  /** Coolify polls liveness every few seconds; those lines would drown everything else. */
  it('does not log the liveness probe', async () => {
    const { lines, logger } = capture();
    await request(appWith(logger)).get('/health');
    expect(lines).toEqual([]);
  });
});
