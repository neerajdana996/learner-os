import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopicSummarySchema } from '@learnos/shared';
import { ResponseShapeError, sendJson } from '../respond.js';

/** Just enough of an Express response to see what was sent. */
function fakeResponse() {
  const sent: { status?: number; body?: unknown } = {};
  const res = {
    req: { method: 'GET', originalUrl: '/topics/abc?x=1' },
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: unknown) {
      sent.body = body;
      return this;
    },
  };
  return { res: res as unknown as Response, sent };
}

const topic = {
  id: '6f1c0a52-8a39-4c55-9f59-5f3ab6f5c8a1',
  title: 'Dynamic programming',
  why: null,
  language: 'Python',
  status: 'active',
  error: null,
  // Dates, as a service returns them — the schema describes the wire.
  startsAt: new Date('2026-01-01T00:00:00Z'),
  endsAt: new Date('2026-01-31T00:00:00Z'),
  dailyBudgetMin: 15,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  counts: { concepts: 12, items: 80 },
  progress: null,
};

describe('sendJson (T-075)', () => {
  afterEach(() => {
    vi.doUnmock('../env.js');
    vi.resetModules();
  });

  it('sends a body that matches, checked as it will arrive (Dates as strings)', () => {
    const { res, sent } = fakeResponse();
    sendJson(res, TopicSummarySchema, topic, 200);
    expect(sent).toEqual({ status: 200, body: topic });
  });

  it('throws, naming the field and the route, when a controller drops a field', () => {
    // T-072's bug exactly: the list sent no `endsAt`, and the dashboard told
    // every learner it was their final day.
    const { endsAt: _dropped, ...withoutEndsAt } = topic;
    const { res, sent } = fakeResponse();

    let thrown: unknown;
    try {
      sendJson(res, TopicSummarySchema, withoutEndsAt);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ResponseShapeError);
    expect((thrown as ResponseShapeError).route).toBe('GET /topics/abc');
    expect((thrown as ResponseShapeError).issues.join()).toMatch(/^endsAt: /);
    expect(sent.body).toBeUndefined();
  });

  it('sends the original body, not the stripped parse, so dev answers like production', () => {
    const { res, sent } = fakeResponse();
    sendJson(res, TopicSummarySchema, { ...topic, extra: 'kept' });
    expect(sent.body).toMatchObject({ extra: 'kept' });
  });

  it('does not check in production, where drift must not become a 500', async () => {
    vi.resetModules();
    vi.doMock('../env.js', () => ({ isProd: true }));
    const { sendJson: prodSendJson } = await import('../respond.js');
    const { res, sent } = fakeResponse();

    prodSendJson(res, TopicSummarySchema, { id: 'not even close' });

    expect(sent).toEqual({ status: 200, body: { id: 'not even close' } });
  });
});

/**
 * The check only protects a response that goes through it. Every JSON body a
 * controller or router sends must be `sendJson`, except an `{ error }` body,
 * which is the error contract rather than a feature's response shape.
 */
describe('every route sends through its shared schema (T-075)', () => {
  const SRC = join(import.meta.dirname, '..', '..');

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
      return /\.(controller|routes)\.ts$/.test(name) ? [path] : [];
    });
  }

  it('has no bare res.json with a non-error body', () => {
    const files = [...sources(join(SRC, 'modules')), join(SRC, 'routes', 'health.ts')];
    expect(files.length).toBeGreaterThan(10);

    const offenders = files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => /\.json\(/.test(line) && !/\.json\(\{\s*error:/.test(line))
        .map(({ line, index }) => `${relative(SRC, file)}:${index + 1}: ${line.trim()}`),
    );

    expect(offenders).toEqual([]);
  });
});
