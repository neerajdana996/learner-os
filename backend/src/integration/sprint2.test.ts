/**
 * Sprint 2 integration walk (T-026).
 *
 * Same shape as sprint1.test.ts — mocked generation, real Postgres and Redis —
 * but it walks the whole sprint through the API: magic link → onboarding →
 * topic → diagnostic → session → map → a day passes → review queue.
 *
 * The point is not the happy path shape. It is the two guarantees the pilot's
 * result rests on: the diagnostic measures without scheduling, and the
 * held-out control group never leaks a title or a question to the learner.
 * Every request below carries a real session cookie obtained from a magic
 * link — no `x-user-id` anywhere, which is what makes this the proof of
 * sprint.md's auth exit criterion.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { and, eq, sql } from 'drizzle-orm';
import { createApp } from '../app.js';
import { db } from '../db/client.js';
import { cards, concepts, reviewEvents, topics } from '../db/schema.js';
import { consoleTransport, setMailTransport, type Mail } from '../lib/mail.js';
import { seededRng } from '../lib/heldOut.js';
import { processGenerationJob } from '../workers/generator.worker.js';
import { truncateAll } from '../test/db.js';
import { resetAuthRateLimits } from '../modules/auth/auth.rateLimit.js';
import { SESSION_COOKIE } from '../modules/auth/cookie.js';
import { closeGenerationQueue, getGenerationQueue } from '../workers/queue.js';

const CONCEPT_COUNT = 12;
/** Everything past the first three depends on one of them, so the diagnostic
 *  has a real graph to walk and the session has real prerequisites to gate on. */
const prereqsFor = (index: number) => (index < 3 ? [] : [`concept-${(index % 3) + 1}`]);

vi.mock('../generator/conceptMap.js', () => ({
  generateConceptMap: vi.fn(async () => ({
    topic: 'React Hooks',
    concepts: Array.from({ length: CONCEPT_COUNT }, (_, index) => ({
      slug: `concept-${index + 1}`,
      title: `Concept ${index + 1}`,
      summary: `Summary ${index + 1}`,
      prereqs: prereqsFor(index),
    })),
  })),
}));

vi.mock('../generator/items.js', () => ({
  generateItems: vi.fn(async (concept: string) => ({
    topic: concept,
    items: [
      { payload: { type: 'recall', prompt: `${concept}: recall`, answer: 'the answer', accept: [] }, isTransfer: false },
      { payload: { type: 'recognition', prompt: `${concept}: recognition`, options: ['a', 'b', 'c', 'd'], answerIndex: 1 }, isTransfer: false },
      { payload: { type: 'application', prompt: `${concept}: application`, answer: 'the answer', accept: [] }, isTransfer: false },
      { payload: { type: 'explain', prompt: `${concept}: explain`, rubric: 'Mentions the answer.' }, isTransfer: false },
      { payload: { type: 'recall', prompt: `${concept}: transfer`, answer: 'the answer', accept: [] }, isTransfer: true },
      { payload: { type: 'recall', prompt: `${concept}: extra`, answer: 'the answer', accept: [] }, isTransfer: false },
    ],
  })),
}));

vi.mock('../generator/teaching.js', () => ({
  generateTeaching: vi.fn(async ({ concept, teachMode }: { concept: string; teachMode: string }) => ({
    tryFirstPrompt: `Before we start: what do you think ${concept} does?`,
    explanationShort: `${concept} in brief (${teachMode}).`,
    explanationLong: `${concept} at greater length, with more detail than the short form.`,
    corrections: [
      { wrong: 'a misconception', why: 'because' },
      { wrong: 'another', why: 'also because' },
    ],
  })),
}));

/**
 * The grader's model call, stubbed at the same boundary the unit tests use.
 * Application and explain items are the ones T-FIX-005 routes through a model,
 * and the network is blocked in tests — so without this the walk cannot answer
 * a free-text item at all.
 */
vi.mock('../generator/grade.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../generator/grade.js')>()),
  gradeExplanation: vi.fn(async (_rubric: string, response: string) => ({
    correct: response.toLowerCase().includes('answer'),
    feedback: 'Judged by the stubbed grader.',
  })),
}));

const app = createApp();
const DAY = 86_400_000;
const LEARNER = 'learner@example.com';

const sent: Mail[] = [];

/** The full magic-link round trip: request, read the link out of the mail the
 *  learner would have received, verify, keep the session cookie. */
async function login(email = LEARNER): Promise<string> {
  sent.length = 0;
  const requested = await request(app).post('/auth/magic').send({ email });
  expect(requested.status).toBe(200);

  const mail = sent.at(-1);
  if (!mail) throw new Error('no magic link was sent');
  const token = /token=([^\s]+)/.exec(mail.text)?.[1];
  if (!token) throw new Error(`no token in mail: ${mail.text}`);

  const verified = await request(app).get('/auth/verify').query({ token: decodeURIComponent(token) });
  expect(verified.status).toBe(302);

  const cookie = (verified.headers['set-cookie'] as unknown as string[])
    .map((value) => value.split(';')[0] ?? '')
    .find((value) => value.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) throw new Error('verify did not set a session cookie');
  return cookie;
}

async function createTopic(cookie: string): Promise<string> {
  const created = await request(app)
    .post('/topics')
    .set('Cookie', cookie)
    .send({
      title: 'React Hooks',
      why: 'I re-read the docs every time and it never sticks.',
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 30 * DAY).toISOString(),
      dailyBudgetMin: 15,
    });
  expect(created.status).toBe(202);
  // Inline rather than through a worker process, exactly as sprint1 does. The
  // seed is pinned so held-out selection and teach-mode assignment are the same
  // on every run.
  await processGenerationJob({ topicId: created.body.topicId }, seededRng(11));
  return created.body.topicId;
}

/** Answers the whole diagnostic. `correct: false` is the honest day-0 case for
 *  a learner who is about to be taught the topic. */
async function runDiagnostic(cookie: string, topicId: string, correct = false) {
  let response = await request(app).post(`/diagnostic/${topicId}/start`).set('Cookie', cookie);
  expect(response.status).toBe(200);

  let asked = 0;
  while (response.body.done === false) {
    asked += 1;
    if (asked > 20) throw new Error('diagnostic did not terminate');
    response = await request(app)
      .post(`/diagnostic/${topicId}/answer`)
      .set('Cookie', cookie)
      .send({
        conceptId: response.body.conceptId,
        itemId: response.body.item.itemId,
        response: correct ? 'the answer' : 'no idea',
        confidence: correct ? 'sure' : 'guess',
        latencyMs: 4000,
      });
    expect(response.status).toBe(200);
  }
  return { asked, summary: response.body.summary };
}

interface PublicItem {
  itemId: string;
  type: 'recall' | 'recognition' | 'application' | 'explain';
  options?: string[];
}

interface DayResult {
  newConcepts: { conceptId: string; title: string; teachMode: string; item: PublicItem }[];
  dueReviews: PublicItem[];
  completedToday: boolean;
}

/**
 * A correct answer in the shape that item type expects — an option index for
 * multiple choice, text for everything else. The client never sees the key
 * (T-010 strips it), so this is exactly what a learner who knows the material
 * would send.
 */
function correctAnswerFor(item: PublicItem): string | number {
  return item.type === 'recognition' ? 1 : 'the answer';
}

async function answerItem(cookie: string, item: PublicItem, confidence: 'guess' | 'think' | 'sure') {
  return request(app)
    .post('/reviews')
    .set('Cookie', cookie)
    .send({
      itemId: item.itemId,
      response: correctAnswerFor(item),
      confidence,
      latencyMs: 3000,
      surface: 'web',
    });
}

/** One day of study: fetch the session, answer everything in it, complete. */
async function studyOneDay(cookie: string): Promise<DayResult> {
  const session = await request(app).get('/session').set('Cookie', cookie);
  expect(session.status).toBe(200);
  const body = session.body as DayResult;

  for (const item of [...body.newConcepts.map((c) => c.item), ...body.dueReviews]) {
    const answered = await answerItem(cookie, item, 'think');
    expect(answered.status).toBe(200);
    expect(answered.body.correct).toBe(true);
  }

  const completed = await request(app)
    .post('/session/complete')
    .set('Cookie', cookie)
    .send({ conceptIds: body.newConcepts.map((c) => c.conceptId) });
  expect(completed.status).toBe(200);
  return body;
}

/** Moves every timestamp for this learner back a day, which is the same thing
 *  as the clock moving forward — and unlike injecting a `now`, it goes through
 *  the routes the learner's browser actually calls. */
async function advanceOneDay(userId: string) {
  await db
    .update(cards)
    .set({
      due: sql`${cards.due} - interval '1 day'`,
      lastReview: sql`${cards.lastReview} - interval '1 day'`,
      taughtAt: sql`${cards.taughtAt} - interval '1 day'`,
    })
    .where(eq(cards.userId, userId));
  await db
    .update(reviewEvents)
    .set({ createdAt: sql`${reviewEvents.createdAt} - interval '1 day'` })
    .where(eq(reviewEvents.userId, userId));
}

async function userIdFor(cookie: string): Promise<string> {
  const me = await request(app).get('/me').set('Cookie', cookie);
  expect(me.status).toBe(200);
  return me.body.id;
}

beforeEach(async () => {
  await truncateAll();
  await getGenerationQueue().obliterate({ force: true });
  resetAuthRateLimits();
  sent.length = 0;
  setMailTransport({
    async send(mail) {
      sent.push(mail);
    },
  });
});

afterEach(() => {
  setMailTransport(consoleTransport);
});

afterAll(async () => {
  await closeGenerationQueue();
});

describe('Sprint 2 integration flow', () => {
  it('walks a learner from magic link to a scheduled review, on a real session', async () => {
    const cookie = await login();
    const userId = await userIdFor(cookie);

    // Onboarding profile (T-014): timezone is what makes "today" the learner's.
    const onboarded = await request(app)
      .patch('/me')
      .set('Cookie', cookie)
      .send({ name: 'Pilot One', timezone: 'Asia/Kolkata', activeWindows: [{ start: '09:00', end: '12:00' }] });
    expect(onboarded.status).toBe(200);
    expect(onboarded.body.timezone).toBe('Asia/Kolkata');

    const topicId = await createTopic(cookie);
    const [topic] = await db.select().from(topics).where(eq(topics.id, topicId));
    expect(topic?.status).toBe('active');

    const diagnostic = await runDiagnostic(cookie, topicId);
    expect(diagnostic.asked).toBeGreaterThan(0);
    expect(diagnostic.asked).toBeLessThanOrEqual(15);

    // Nothing has been taught, so there is nothing to score yet.
    const beforeTeaching = await request(app).get(`/topics/${topicId}/map`).set('Cookie', cookie);
    expect(beforeTeaching.status).toBe(200);
    expect(beforeTeaching.body.score).toBe(0);
    expect(beforeTeaching.body.concepts).toHaveLength(CONCEPT_COUNT);

    const day1 = await studyOneDay(cookie);
    expect(day1.newConcepts.length).toBeGreaterThan(0);
    expect(day1.newConcepts.length).toBeLessThanOrEqual(3);
    // Every new concept arrives teachable: prose, an arm, and one retrieval item.
    for (const concept of day1.newConcepts) {
      expect(concept.title).toBeTruthy();
      expect(['try_first', 'example_first']).toContain(concept.teachMode);
      expect(concept.item.itemId).toBeTruthy();
    }

    // cards.taughtAt is what lets the extension start asking (plan.md §6).
    const taught = await db
      .select({ conceptId: cards.conceptId, taughtAt: cards.taughtAt })
      .from(cards)
      .where(and(eq(cards.userId, userId), sql`${cards.taughtAt} is not null`));
    expect(taught.map((row) => row.conceptId).sort()).toEqual(
      day1.newConcepts.map((c) => c.conceptId).sort(),
    );

    const afterTeaching = await request(app).get(`/topics/${topicId}/map`).set('Cookie', cookie);
    expect(afterTeaching.body.score).toBeGreaterThan(0);
    expect(afterTeaching.body.concepts.filter((c: { state: string }) => c.state === 'taught')).toHaveLength(
      day1.newConcepts.length,
    );

    // Every web review carries the two fields plan.md §6 requires.
    const webEvents = await db
      .select()
      .from(reviewEvents)
      .where(and(eq(reviewEvents.userId, userId), eq(reviewEvents.surface, 'web')));
    expect(webEvents.length).toBe(day1.newConcepts.length);
    for (const event of webEvents) {
      expect(event.predictedRecall).not.toBeNull();
      expect(event.cardId).not.toBeNull();
    }

    await advanceOneDay(userId);

    const due = await request(app).get('/due?limit=10').set('Cookie', cookie);
    expect(due.status).toBe(200);
    expect(due.body.items.length).toBeGreaterThan(0);

    // Answering after a day's gap is what "did it stick" is measured on (T-040).
    const first = due.body.items[0] as PublicItem;
    const answered = await answerItem(cookie, first, 'sure');
    expect(answered.status).toBe(200);
    expect(answered.body.correct).toBe(true);
    expect(answered.body.gapDaysSinceLast).toBeGreaterThanOrEqual(1);
  });

  it('records the diagnostic without scheduling anything', async () => {
    const cookie = await login();
    const userId = await userIdFor(cookie);
    const topicId = await createTopic(cookie);

    await runDiagnostic(cookie, topicId);

    const events = await db.select().from(reviewEvents).where(eq(reviewEvents.userId, userId));
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.surface).toBe('diagnostic');
      // The whole point: measuring prior knowledge must not move a schedule,
      // or day-0 contaminates the retention comparison it exists to anchor.
      expect(event.cardId).toBeNull();
      expect(event.predictedRecall).not.toBeNull();
    }

    const rows = await db.select().from(cards).where(eq(cards.userId, userId));
    // The diagnostic seeds cards so the planner has state to work from, but
    // none of them has been reviewed or taught.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.reps === 0)).toBe(true);
    expect(rows.every((row) => row.taughtAt === null)).toBe(true);

    const map = await request(app).get(`/topics/${topicId}/map`).set('Cookie', cookie);
    expect(map.body.score).toBe(0);
    expect(map.body.concepts.every((c: { state: string }) => c.state !== 'taught')).toBe(true);
  });

  it('never leaks a held-out concept — not its title, not a question', async () => {
    const cookie = await login();
    const userId = await userIdFor(cookie);
    const topicId = await createTopic(cookie);
    await runDiagnostic(cookie, topicId);

    const heldOut = await db
      .select({ id: concepts.id, title: concepts.title })
      .from(concepts)
      .where(and(eq(concepts.topicId, topicId), eq(concepts.heldOut, true)));
    // Without a control group there is no pilot result to report, so its
    // existence is asserted before anything about its behaviour.
    expect(heldOut.length).toBeGreaterThan(0);
    const heldOutIds = new Set(heldOut.map((row) => row.id));

    const map = await request(app).get(`/topics/${topicId}/map`).set('Cookie', cookie);
    const mapped = map.body.concepts.filter((c: { conceptId: string }) => heldOutIds.has(c.conceptId));
    expect(mapped).toHaveLength(heldOut.length);
    for (const concept of mapped) {
      expect(concept.title).toBeNull();
      expect(concept.state).toBe('heldout');
    }
    // The rendered map, as a whole, contains none of their titles.
    for (const row of heldOut) expect(JSON.stringify(map.body)).not.toContain(row.title);

    // Study the entire topic out, a day at a time.
    const seenInSessions = new Set<string>();
    for (let day = 0; day < CONCEPT_COUNT; day += 1) {
      const result = await studyOneDay(cookie);
      for (const concept of result.newConcepts) seenInSessions.add(concept.conceptId);
      await advanceOneDay(userId);
      if (result.newConcepts.length === 0) break;
    }

    for (const id of heldOutIds) expect(seenInSessions.has(id)).toBe(false);
    expect(seenInSessions.size).toBe(CONCEPT_COUNT - heldOut.length);

    const due = await request(app).get('/due?limit=50').set('Cookie', cookie);
    for (const item of due.body.items) expect(heldOutIds.has(item.conceptId)).toBe(false);

    const everTaught = await db
      .select({ conceptId: cards.conceptId })
      .from(cards)
      .where(and(eq(cards.userId, userId), sql`${cards.taughtAt} is not null`));
    for (const row of everTaught) expect(heldOutIds.has(row.conceptId)).toBe(false);
  });

  it('offers both teaching arms across the topic', async () => {
    const cookie = await login();
    const userId = await userIdFor(cookie);
    const topicId = await createTopic(cookie);
    await runDiagnostic(cookie, topicId);

    const stored = await db
      .select({ teachMode: concepts.teachMode, heldOut: concepts.heldOut })
      .from(concepts)
      .where(eq(concepts.topicId, topicId));
    const storedModes = new Set(stored.filter((c) => !c.heldOut).map((c) => c.teachMode));
    // If generation ever stops randomising this, the A/B in plan.md §3.4
    // measures nothing — so the fixture's own precondition is asserted first.
    expect(storedModes).toEqual(new Set(['try_first', 'example_first']));

    const offered = new Map<string, string>();
    for (let day = 0; day < CONCEPT_COUNT; day += 1) {
      const result = await studyOneDay(cookie);
      for (const concept of result.newConcepts) offered.set(concept.conceptId, concept.teachMode);
      await advanceOneDay(userId);
      if (result.newConcepts.length === 0) break;
    }

    expect(new Set(offered.values())).toEqual(new Set(['try_first', 'example_first']));

    // And what the session said matches what was generated, concept by concept:
    // an arm the UI doesn't honour is an arm that isn't being tested.
    const rows = await db
      .select({ id: concepts.id, teachMode: concepts.teachMode })
      .from(concepts)
      .where(eq(concepts.topicId, topicId));
    for (const row of rows) {
      const seen = offered.get(row.id);
      if (seen) expect(seen).toBe(row.teachMode);
    }
  });

  it('marks the day complete once, and a second completion is a no-op', async () => {
    const cookie = await login();
    const userId = await userIdFor(cookie);
    const topicId = await createTopic(cookie);
    await runDiagnostic(cookie, topicId);

    const before = await request(app).get('/session').set('Cookie', cookie);
    expect(before.body.completedToday).toBe(false);

    const conceptIds = before.body.newConcepts.map((c: { conceptId: string }) => c.conceptId);
    const first = await request(app).post('/session/complete').set('Cookie', cookie).send({ conceptIds });
    expect(first.status).toBe(200);

    const after = await request(app).get('/session').set('Cookie', cookie);
    expect(after.body.completedToday).toBe(true);
    // The concepts just taught are no longer offered as new.
    expect(after.body.newConcepts.map((c: { conceptId: string }) => c.conceptId)).not.toEqual(conceptIds);

    // Replaying the same completion must not re-teach or re-schedule: the ids
    // are no longer on offer, so it is rejected rather than applied twice.
    const replay = await request(app).post('/session/complete').set('Cookie', cookie).send({ conceptIds });
    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe('not_offered');

    // Completing today's (new) plan again leaves exactly one session_days row.
    const second = await request(app)
      .post('/session/complete')
      .set('Cookie', cookie)
      .send({ conceptIds: after.body.newConcepts.map((c: { conceptId: string }) => c.conceptId) });
    expect(second.status).toBe(200);

    const days = await db.execute(
      sql`select count(*)::int as count from session_days where user_id = ${userId} and topic_id = ${topicId}`,
    );
    expect(days[0]?.count).toBe(1);
  });

  it('serves none of it without a session', async () => {
    const cookie = await login();
    const topicId = await createTopic(cookie);

    for (const path of ['/me', '/session', '/due', `/topics/${topicId}/map`]) {
      const res = await request(app).get(path);
      expect(res.status, `${path} without a cookie`).toBe(401);
    }
  });
});
