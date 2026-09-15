import { Router } from 'express';
import { Redis } from 'ioredis';
import { pg } from '../db/client.js';
import { env } from '../lib/env.js';
import { log } from '../lib/log.js';

/**
 * Liveness and readiness (T-047).
 *
 * **Two endpoints on purpose.** `/health` is liveness: Coolify polls it and
 * restarts the container when it fails, so it must not depend on anything
 * outside the process. If it checked Postgres, a thirty-second database blip
 * would become a restart loop of a backend that was never broken.
 *
 * `/health/ready` is readiness: it asks Postgres and Redis whether they
 * actually answer. It exists because on 2026-09-13 the backend reported
 * `running:healthy` through a total database outage — `/health` touched no
 * database, so nothing anywhere said the product was down.
 */

export type CheckResult = 'ok' | 'down';

export interface ReadinessChecks {
  postgres: () => Promise<void>;
  redis: () => Promise<void>;
}

/** Long enough for a real answer, short enough that a hung dependency cannot
 *  hang the probe that is meant to report it. */
export const READINESS_TIMEOUT_MS = 2000;

function withTimeout<T>(work: Promise<T>, ms: number, name: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${name} did not answer within ${ms}ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

let redis: Redis | undefined;

/**
 * Its own connection, built on first use. BullMQ's connections belong to the
 * queues; a readiness probe borrowing one could mask exactly the failure it is
 * meant to see. `enableOfflineQueue: false` makes a ping against a lost
 * connection fail at once rather than wait for a reconnect.
 */
function readinessRedis(): Redis {
  redis ??= new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: READINESS_TIMEOUT_MS,
  });
  return redis;
}

/** Releases the probe's Redis connection — graceful shutdown and tests. */
export async function closeReadinessRedis(): Promise<void> {
  const client = redis;
  redis = undefined;
  if (!client) return;
  await client.quit().catch(() => client.disconnect());
}

export const liveChecks: ReadinessChecks = {
  postgres: async () => {
    await pg`select 1`;
  },
  redis: async () => {
    const client = readinessRedis();
    if (client.status === 'wait') await client.connect();
    await client.ping();
  },
};

export function createHealthRouter(checks: ReadinessChecks = liveChecks, timeoutMs = READINESS_TIMEOUT_MS): Router {
  const router = Router();

  /** Liveness. Coolify restarts on this, so it answers from the process alone. */
  router.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  /**
   * Readiness. Names which dependency is down and nothing more: an error
   * message can carry a hostname or a connection detail, so it goes to the log
   * with the request id, never into a response anyone can fetch.
   */
  router.get('/health/ready', async (_req, res) => {
    const run = async (name: keyof ReadinessChecks): Promise<CheckResult> => {
      try {
        await withTimeout(checks[name](), timeoutMs, name);
        return 'ok';
      } catch (error) {
        log.warn('readiness_check_failed', { check: name, requestId: res.locals.requestId, error });
        return 'down';
      }
    };

    const [postgres, redisResult] = await Promise.all([run('postgres'), run('redis')]);
    const ok = postgres === 'ok' && redisResult === 'ok';
    res.status(ok ? 200 : 503).json({ ok, checks: { postgres, redis: redisResult } });
  });

  return router;
}

export const healthRouter = createHealthRouter();
