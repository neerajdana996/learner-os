import { beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { db } from '../client.js';
import { cards, concepts, topics } from '../schema.js';
import { seedUser, truncateAll } from '../../test/db.js';

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
  return { user, concept };
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
});
