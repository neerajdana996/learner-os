import { beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { db } from '../client.js';
import { authTokens, cards, concepts, sessionDays, sessions, topics, users } from '../schema.js';
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

    const rows = await db.select().from(sessions);
    expect(rows).toHaveLength(2);
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
});
