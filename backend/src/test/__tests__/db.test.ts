import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/client.js';
import { concepts, topics, users } from '../../db/schema.js';
import { seedUser, truncateAll } from '../db.js';

describe('db helpers', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('seedUser inserts a row and truncateAll clears it', async () => {
    const user = await seedUser();
    expect(user.email).toContain('@example.com');
    expect(await db.$count(users)).toBe(1);

    await truncateAll();
    expect(await db.$count(users)).toBe(0);
  });

  it('inserting a topic with a non-existent user_id throws', async () => {
    await expect(
      db.insert(topics).values({ userId: '00000000-0000-0000-0000-000000000000', title: 'Broken topic' }),
    ).rejects.toThrow();
  });

  it('inserting duplicate concept slugs is rejected by the unique index', async () => {
    const user = await seedUser();
    const [topic] = await db.insert(topics).values({ userId: user.id, title: 'Topic' }).returning({ id: topics.id });
    if (!topic) throw new Error('topic insert returned no row');

    await db.insert(concepts).values({ topicId: topic.id, slug: 'state', title: 'State', order: 1 });

    await expect(
      db.insert(concepts).values({ topicId: topic.id, slug: 'state', title: 'State again', order: 2 }),
    ).rejects.toThrow();
  });
});
