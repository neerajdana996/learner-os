import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { ZodTypeAny, z } from 'zod';

type Part = 'body' | 'query' | 'params';

/**
 * Express middleware that validates one part of the request with a Zod schema
 * from `src/shared`. Replaces the parsed (and coerced) value in place, so the
 * route handler can read `req.body` with confidence.
 *
 * Usage: `router.post('/topics', validate(TopicCreateSchema), handler)`
 *        `router.get('/due', validate(DueQuerySchema, 'query'), handler)`
 *
 * 400 body shape: `{ error: 'validation', issues: ZodIssue[] }`
 */
export function validate<S extends ZodTypeAny>(schema: S, part: Part = 'body'): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      res.status(400).json({ error: 'validation', part, issues: result.error.issues });
      return;
    }
    // Express 5 exposes `req.query` as a getter; assign via defineProperty so both
    // body (plain prop) and query/params (getters) can be replaced uniformly.
    Object.defineProperty(req, part, { value: result.data as z.infer<S>, writable: true, configurable: true });
    next();
  };
}
