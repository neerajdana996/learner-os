import type { Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { isProd } from './env.js';

/**
 * A controller sent something its shared schema does not describe (T-075).
 * Only ever thrown outside production.
 */
export class ResponseShapeError extends Error {
  constructor(
    readonly route: string,
    readonly issues: string[],
  ) {
    super(`response for ${route} does not match its schema: ${issues.join('; ')}`);
    this.name = 'ResponseShapeError';
  }
}

/**
 * Checks `body` against the shared schema for its route, then sends it.
 *
 * Why: the client's response types are `z.infer` of `@learnos/shared`, but a
 * type cannot see what a controller actually selects. T-072's list endpoint
 * sent four fields while the client believed in nine, and the dashboard told
 * every learner it was their final day. Parsing here turns that into a failure
 * in the controller's own test.
 *
 * - **Checked as it will arrive**, after a JSON round trip: services return
 *   `Date`s that the wire carries as strings, and the schema describes the
 *   wire.
 * - **The original body is sent**, not the parsed one. Zod strips unknown keys,
 *   so sending its output would make development answer differently from
 *   production, where no parse runs.
 * - **Not in production.** A mismatch there would turn a harmless extra or a
 *   loosely-typed field into a 500 for a learner mid-session; the test suite
 *   and development are where drift must be loud, and they both run this.
 */
export function sendJson(res: Response, schema: ZodTypeAny, body: unknown, status = 200): void {
  if (!isProd) {
    const wire: unknown = body === undefined ? undefined : JSON.parse(JSON.stringify(body));
    const result = schema.safeParse(wire);
    if (!result.success) {
      const route = `${res.req.method} ${res.req.originalUrl.split('?')[0]}`;
      throw new ResponseShapeError(
        route,
        result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
      );
    }
  }
  res.status(status).json(body);
}
