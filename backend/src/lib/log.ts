import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

/**
 * Structured logs (T-047).
 *
 * One JSON object per line — `time`, `level`, `event`, then fields — written to
 * stdout or stderr, which is what Coolify captures. A line a machine can filter
 * ("every `http_request` with status ≥ 500 for this `requestId`") is the
 * difference between reading a production failure and scrolling past it.
 *
 * No dependency: the whole job is `JSON.stringify` and two rules — redact
 * anything that looks like a credential, and serialise errors with their
 * `cause`, because drizzle wraps the driver's real error there (T-154).
 */

export type LogLevel = 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;
export type LogSink = (level: LogLevel, line: string) => void;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

const REDACTED = '[redacted]';

/** A field named like one of these never reaches a log line, at any depth. */
const SECRET_KEY = /pass(word)?|secret|token|authorization|cookie|api[-_]?key|dsn/i;

const MAX_DEPTH = 6;

export function serializeError(error: unknown, depth = 0): unknown {
  if (!(error instanceof Error)) return error;
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    ...(error.cause !== undefined && depth < 3 ? { cause: serializeError(error.cause, depth + 1) } : {}),
  };
}

function clean(value: unknown, depth = 0): unknown {
  if (value instanceof Error) return serializeError(value);
  if (value instanceof Date) return value.toISOString();
  if (value === null || typeof value !== 'object' || depth > MAX_DEPTH) return value;
  if (Array.isArray(value)) return value.map((entry) => clean(entry, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, SECRET_KEY.test(key) ? REDACTED : clean(entry, depth + 1)]),
  );
}

export function createLogger(sink: LogSink, now: () => Date = () => new Date()): Logger {
  const write = (level: LogLevel, event: string, fields: LogFields = {}) => {
    let line: string;
    try {
      line = JSON.stringify({ time: now().toISOString(), level, event, ...(clean(fields) as LogFields) });
    } catch {
      // A cyclic or otherwise unserialisable field must not take the request
      // down with it; the event name alone is still worth having.
      line = JSON.stringify({ time: now().toISOString(), level, event, note: 'fields could not be serialised' });
    }
    sink(level, line);
  };
  return {
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
  };
}

const consoleSink: LogSink = (level, line) => {
  if (level === 'error') console.error(line);
  else console.log(line);
};

/**
 * The process logger. Silent under vitest (`vitest.setup.ts` sets
 * `NODE_ENV=test` before any import), because a suite that deliberately fails
 * requests would otherwise bury real output. Tests that care about a line build
 * their own with `createLogger` and a capturing sink.
 */
export const log: Logger = createLogger(process.env.NODE_ENV === 'test' ? () => {} : consoleSink);

/** An inbound id is reused only if it looks like one — a header is user input. */
const INBOUND_REQUEST_ID = /^[A-Za-z0-9._-]{8,100}$/;

/**
 * Tags every request with an id and logs it once it finishes (T-047).
 *
 * The id goes back as `X-Request-Id` and onto every line about that request,
 * including the 500 handler's, so a learner's "it broke at 14:02" can be
 * matched to the one line that says why.
 *
 * **The path is logged, never the URL.** `/auth/verify?token=…` carries a live
 * sign-in token and the OAuth callbacks carry `?code=` — `req.path` excludes
 * the query string, so neither can reach a log. `/health` is not logged at
 * all: Coolify polls it every few seconds, and those lines would drown the rest.
 */
export function requestLogging(logger: Logger = log): RequestHandler {
  return (req, res, next) => {
    const inbound = req.get('x-request-id');
    const requestId = inbound && INBOUND_REQUEST_ID.test(inbound) ? inbound : randomUUID();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    const started = process.hrtime.bigint();
    res.on('finish', () => {
      if (req.path === '/health') return;
      const fields = {
        requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Math.round(Number(process.hrtime.bigint() - started) / 1e6),
      };
      if (res.statusCode >= 500) logger.error('http_request', fields);
      else logger.info('http_request', fields);
    });
    next();
  };
}
