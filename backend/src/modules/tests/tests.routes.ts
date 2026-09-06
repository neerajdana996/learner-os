import { Router, type Response } from 'express';
import { IdParamSchema, TestStartSchema, TestSubmitSchema } from '@learnos/shared';
import { validate } from '../../lib/validate.js';
import { requireUser, userId } from '../../middleware/auth.js';
import { enqueueTest, getTestQueue } from '../../workers/tests.queue.js';
import { existingTest, ownedTopic } from './tests.repository.js';
import { answerTestItem, completeTest, nextTestItem, readyTopic, TestError } from './tests.service.js';

export const testsRouter = Router();
async function respond(res: Response, run: () => Promise<unknown>) {
  try { res.json(await run()); } catch (error) {
    if (error instanceof TestError) { res.status(error.status).json({ error: error.reason }); return; }
    throw error;
  }
}
testsRouter.post('/topics/:id/tests', requireUser, validate(IdParamSchema, 'params'), validate(TestStartSchema), async (req, res) => {
  await respond(res, async () => {
    const topicId = String(req.params.id);
    const { existing } = await readyTopic(userId(req), topicId, new Date());
    if (existing) return { testId: existing.id, state: 'ready' };
    const result = await enqueueTest({ userId: userId(req), topicId }, true);
    res.status(202);
    return result;
  });
});
testsRouter.get('/topics/:id/tests', requireUser, validate(IdParamSchema, 'params'), async (req, res) => {
  await respond(res, async () => {
    const topicId = String(req.params.id);
    if (!await ownedTopic(userId(req), topicId)) throw new TestError('not_found', 404);
    const test = await existingTest(topicId);
    if (test) return { testId: test.id, state: 'ready' };
    const job = await getTestQueue().getJob(`day30-${topicId}`);
    return { testId: null, state: job ? await job.getState() : 'not_started' };
  });
});
testsRouter.get('/tests/:id/next', requireUser, validate(IdParamSchema, 'params'), async (req, res) => {
  await respond(res, () => nextTestItem(userId(req), String(req.params.id)));
});
testsRouter.post('/tests/:id/answer', requireUser, validate(IdParamSchema, 'params'), validate(TestSubmitSchema), async (req, res) => {
  await respond(res, () => answerTestItem(userId(req), String(req.params.id), req.body));
});
testsRouter.post('/tests/:id/complete', requireUser, validate(IdParamSchema, 'params'), async (req, res) => {
  await respond(res, () => completeTest(userId(req), String(req.params.id)));
});
