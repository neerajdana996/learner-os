import { afterAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ReadinessResponseSchema } from '@learnos/shared';
import { createApp } from '../app.js';
import { closeReadinessRedis, createHealthRouter, type ReadinessChecks } from '../routes/health.js';

/**
 * Liveness and readiness (T-047).
 *
 * The task's listed tests say "`/health` returns 503 if Redis is down … if
 * Postgres is unreachable". They run against `/health/ready` instead, and the
 * last test below is why: `/health` is what Coolify restarts on, and a
 * liveness probe that fails on a database blip turns the blip into a restart
 * loop of a backend that was never broken.
 */
const up = async () => {};
const down = async () => {
  throw new Error('connect ECONNREFUSED 10.0.0.7:5432');
};
const hangs = () => new Promise<void>(() => {});

function appWith(checks: ReadinessChecks, timeoutMs = 2000) {
  const app = express();
  app.use(createHealthRouter(checks, timeoutMs));
  return app;
}

afterAll(async () => {
  await closeReadinessRedis();
});

describe('GET /health/ready', () => {
  it('answers 200 against the real test database and Redis', async () => {
    const res = await request(createApp()).get('/health/ready');

    expect(res.status).toBe(200);
    expect(ReadinessResponseSchema.parse(res.body)).toEqual({ ok: true, checks: { postgres: 'ok', redis: 'ok' } });
  });

  it('is 503 and names Redis when Redis is down', async () => {
    const res = await request(appWith({ postgres: up, redis: down })).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, checks: { postgres: 'ok', redis: 'down' } });
  });

  it('is 503 and names Postgres when Postgres is unreachable', async () => {
    const res = await request(appWith({ postgres: down, redis: up })).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, checks: { postgres: 'down', redis: 'ok' } });
  });

  /** A hung dependency must not hang the probe that exists to report it. */
  it('reports a dependency that never answers as down, within the timeout', async () => {
    const started = Date.now();
    const res = await request(appWith({ postgres: hangs, redis: up }, 50)).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.checks.postgres).toBe('down');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  /** An address or a connection detail belongs in the log, not a public response. */
  it('never puts the underlying error in the response', async () => {
    const res = await request(appWith({ postgres: down, redis: down })).get('/health/ready');
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.7');
  });
});

describe('GET /health', () => {
  /**
   * The split, asserted. Liveness answers from the process alone, so an outage
   * of both dependencies still reads as a live process — which is correct, and
   * is what stops Coolify from restart-looping a healthy container.
   */
  it('stays 200 while both dependencies are down', async () => {
    const res = await request(appWith({ postgres: down, redis: down })).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
