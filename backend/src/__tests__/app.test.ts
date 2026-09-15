import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createApp, errorHandler } from '../app.js';
import { createLogger, requestLogging } from '../lib/log.js';

describe('app', () => {
  it('GET /health → { ok: true }', async () => {
    const res = await request(createApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('unknown route → 404 json', async () => {
    const res = await request(createApp()).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
  });

  /** T-047: every response carries the id its log lines are filed under. */
  it('tags every response with a request id', async () => {
    const res = await request(createApp()).get('/nope');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  /**
   * T-047. A thrown route becomes one structured line naming the request, and
   * the same id goes back to the client — the string a learner can report.
   */
  it('logs a thrown route as request_failed with the id the client receives', async () => {
    const lines: Record<string, unknown>[] = [];
    const logger = createLogger((_level, line) => lines.push(JSON.parse(line) as Record<string, unknown>));
    const app = express();
    app.use(requestLogging(logger));
    app.get('/explodes', () => {
      throw new Error('kaboom', { cause: new Error('driver said no') });
    });
    app.use(errorHandler(logger));

    const res = await request(app).get('/explodes?token=never-logged');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('internal');
    expect(res.body.requestId).toBe(res.headers['x-request-id']);

    const failed = lines.find((line) => line.event === 'request_failed');
    expect(failed).toMatchObject({ requestId: res.body.requestId, method: 'GET', path: '/explodes' });
    expect((failed?.error as { cause: { message: string } }).cause.message).toBe('driver said no');
    expect(JSON.stringify(lines)).not.toContain('never-logged');
  });
});
