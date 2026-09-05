import { beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { db } from '../client.js';
import { authTokens, cards, concepts, items, reviewEvents, sessionDays, sessions, topics, users } from '../schema.js';
import { seedUser, truncateAll } from '../../test/db.js';

const HOUR = 3_600_000;

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://learnos:learnos@localhost:5432/learnos_test';

async function listTables(): Promise<string[]> {
  const client = postgres(DATABASE_URL, { max: 1 });
  try {
    const rows = await client<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name NOT LIKE 'drizzle_%'
      ORDER BY table_name;
    `;
    return rows.map((row) => row.table_name);
  } finally {
    await client.end();
  }
}

async function seedConcept() {
  const user = await seedUser();
  const [topic] = await db.insert(topics).values({ userId: user.id, title: 'Topic' }).returning({ id: topics.id });
  if (!topic) throw new Error('topic insert returned no row');
  const [concept] = await db
    .insert(concepts)
    .values({ topicId: topic.id, slug: 'state', title: 'State', order: 1 })
    .returning({ id: concepts.id });
  if (!concept) throw new Error('concept insert returned no row');
  return { user, topic, concept };
}

describe('schema', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('creates all required tables', async () => {
    const tables = await listTables();
    expect(tables).toEqual(
      expect.arrayContaining([
        'users',
        'topics',
        'concepts',
        'concept_prereqs',
        'items',
        'cards',
        'review_events',
        'tests',
        'daily_pulse',
        'auth_tokens',
        'sessions',
        'session_days',
      ]),
    );
  });

  it('rejects a review_events row missing predicted_recall', async () => {
    const { user, concept } = await seedConcept();
    const client = postgres(DATABASE_URL, { max: 1 });
    try {
      await expect(
        client`INSERT INTO review_events (user_id, concept_id, correct, surface, gap_days_since_last)
               VALUES (${user.id}, ${concept.id}, true, 'web', 0)`,
      ).rejects.toThrow();
    } finally {
      await client.end();
    }
  });

  it('prevents duplicate cards for the same (user_id, concept_id)', async () => {
    const { user, concept } = await seedConcept();
    await db.insert(cards).values({ userId: user.id, conceptId: concept.id, due: new Date() });

    await expect(
      db.insert(cards).values({ userId: user.id, conceptId: concept.id, due: new Date() }),
    ).rejects.toThrow();
  });

  // T-054 — Sprint 2 additions. Each of these seeds real parent rows first, so
  // the constraint under test is what actually fires rather than an FK error
  // (the mistake T-049's original tests made).
  it('prevents two sessions sharing a token', async () => {
    const user = await seedUser();
    const expiresAt = new Date(Date.now() + HOUR);
    await db.insert(sessions).values({ userId: user.id, token: 'tok-a', expiresAt });

    await expect(
      db.insert(sessions).values({ userId: user.id, token: 'tok-a', expiresAt }),
    ).rejects.toThrow();
  });

  it('allows the same user a web and an extension session', async () => {
    const user = await seedUser();
    const expiresAt = new Date(Date.now() + HOUR);
    await db.insert(sessions).values({ userId: user.id, token: 'web-1', kind: 'web', expiresAt });
    await db.insert(sessions).values({ userId: user.id, token: 'ext-1', kind: 'extension', expiresAt });

    // Scoped to the two rows this test inserts — seedUser logs the user in, so
    // an unfiltered count would also pick up their web session.
    const rows = await db.select().from(sessions).where(inArray(sessions.token, ['web-1', 'ext-1']));
    expect(rows.map((r) => r.kind).sort()).toEqual(['extension', 'web']);
  });

  it('prevents two session_days for the same (user_id, topic_id, day)', async () => {
    const { user, topic } = await seedConcept();
    await db.insert(sessionDays).values({ userId: user.id, topicId: topic.id, day: '2026-09-05' });

    await expect(
      db.insert(sessionDays).values({ userId: user.id, topicId: topic.id, day: '2026-09-05' }),
    ).rejects.toThrow();
  });

  it('allows the same user two session_days on different days', async () => {
    const { user, topic } = await seedConcept();
    await db.insert(sessionDays).values({ userId: user.id, topicId: topic.id, day: '2026-09-05' });
    await db.insert(sessionDays).values({ userId: user.id, topicId: topic.id, day: '2026-09-06' });

    const rows = await db.select().from(sessionDays);
    expect(rows).toHaveLength(2);
  });

  it('rejects an auth_tokens row for a non-existent user', async () => {
    await expect(
      db.insert(authTokens).values({
        userId: '00000000-0000-0000-0000-000000000000',
        token: 'orphan',
        expiresAt: new Date(Date.now() + HOUR),
      }),
    ).rejects.toThrow();
  });

  it('defaults the new user profile columns rather than leaving them null', async () => {
    const user = await seedUser();
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row?.activeWindows).toEqual([]);
    expect(row?.profile).toEqual({});
    expect(row?.timezone).toBeNull();
  });

  it('truncateAll empties the new tables too', async () => {
    const { user, topic } = await seedConcept();
    const expiresAt = new Date(Date.now() + HOUR);
    await db.insert(authTokens).values({ userId: user.id, token: 'a', expiresAt });
    await db.insert(sessions).values({ userId: user.id, token: 'b', expiresAt });
    await db.insert(sessionDays).values({ userId: user.id, topicId: topic.id, day: '2026-09-05' });

    await truncateAll();

    for (const table of [authTokens, sessions, sessionDays]) {
      const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(table);
      expect(row?.count).toBe(0);
    }
  });
  // T-079 — code blocks. All three changes are additive; the point of most of
  // these tests is that nothing that exists today moved.
  it('accepts every concept domain and rejects one that is not a domain', async () => {
    const { topic } = await seedConcept();
    for (const domain of ['code', 'math', 'systems', 'prose'] as const) {
      await db.insert(concepts).values({ topicId: topic.id, slug: domain, title: domain, order: 2, domain });
    }
    const rows = await db.select().from(concepts).where(eq(concepts.topicId, topic.id));
    expect(rows.map((r) => r.domain).filter(Boolean).sort()).toEqual(['code', 'math', 'prose', 'systems']);

    const client = postgres(DATABASE_URL, { max: 1 });
    try {
      await expect(
        client`INSERT INTO concepts (topic_id, slug, title, "order", domain)
               VALUES (${topic.id}, 'js', 'JS', 3, 'javascript')`,
      ).rejects.toThrow();
    } finally {
      await client.end();
    }
  });

  it('leaves a concept domain null rather than defaulting it', async () => {
    // The absence of a default is the whole point: every concept generated
    // before T-082 has a genuinely unknown domain, and 'prose' would be a lie
    // the generator would then never revisit.
    const { concept } = await seedConcept();
    const [row] = await db.select().from(concepts).where(eq(concepts.id, concept.id));
    expect(row?.domain).toBeNull();
  });

  it('still round-trips an item inserted the way the generator inserts one today', async () => {
    const { concept } = await seedConcept();
    const payload = { type: 'recall', prompt: 'What closes a stoma?', answer: 'guard cells' };
    const [inserted] = await db
      .insert(items)
      .values({ conceptId: concept.id, type: 'recall', payload })
      .returning({ id: items.id });
    if (!inserted) throw new Error('item insert returned no row');

    const [row] = await db.select().from(items).where(eq(items.id, inserted.id));
    expect(row?.payload).toEqual(payload);
    expect(row?.answerKind).toBeNull();
  });

  it('indexes items.answer_kind, because the extension pick filters on it', async () => {
    const client = postgres(DATABASE_URL, { max: 1 });
    try {
      const rows = await client<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes WHERE tablename = 'items';
      `;
      expect(rows.map((r) => r.indexname)).toContain('items_answer_kind_idx');
    } finally {
      await client.end();
    }
  });

  it('defaults review_events.assisted to false and refuses an explicit null', async () => {
    const { user, concept } = await seedConcept();
    const [inserted] = await db
      .insert(reviewEvents)
      .values({ userId: user.id, conceptId: concept.id, correct: true, predictedRecall: 0.9 })
      .returning({ id: reviewEvents.id });
    if (!inserted) throw new Error('review_events insert returned no row');

    const [row] = await db.select().from(reviewEvents).where(eq(reviewEvents.id, inserted.id));
    expect(row?.assisted).toBe(false);

    const client = postgres(DATABASE_URL, { max: 1 });
    try {
      await expect(
        client`INSERT INTO review_events (user_id, concept_id, correct, surface, predicted_recall, assisted)
               VALUES (${user.id}, ${concept.id}, true, 'web', 0.9, NULL)`,
      ).rejects.toThrow();
    } finally {
      await client.end();
    }
  });

  // T-091 — the learner picks the language.
  it('leaves topics.language null rather than defaulting it, and round-trips one', async () => {
    const user = await seedUser();
    // Nullable and undefaulted on purpose: "the learner didn't say" and "the
    // learner said it doesn't matter" both land here, and neither is 'JavaScript'.
    const [bare] = await db
      .insert(topics)
      .values({ userId: user.id, title: 'Consistency in distributed systems' })
      .returning({ id: topics.id });
    if (!bare) throw new Error('topic insert returned no row');
    const [bareRow] = await db.select().from(topics).where(eq(topics.id, bare.id));
    expect(bareRow?.language).toBeNull();

    const [chosen] = await db
      .insert(topics)
      .values({ userId: user.id, title: 'Dynamic programming', language: 'Python' })
      .returning({ id: topics.id });
    if (!chosen) throw new Error('topic insert returned no row');
    const [chosenRow] = await db.select().from(topics).where(eq(topics.id, chosen.id));
    expect(chosenRow?.language).toBe('Python');
  });

  it('truncateAll empties the tables T-079 touched', async () => {
    const { user, concept } = await seedConcept();
    await db.insert(items).values({ conceptId: concept.id, type: 'recall', payload: {}, answerKind: 'clozeCode' });
    await db
      .insert(reviewEvents)
      .values({ userId: user.id, conceptId: concept.id, correct: true, predictedRecall: 0.5, assisted: true });

    await truncateAll();

    for (const table of [items, reviewEvents, concepts]) {
      const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(table);
      expect(row?.count).toBe(0);
    }
  });
});
