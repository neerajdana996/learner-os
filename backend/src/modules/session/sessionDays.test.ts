import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/client.js';
import { sessionDays, topics } from '../../db/schema.js';
import { seedUser, truncateAll } from '../../test/db.js';
import { isSessionComplete, markSessionComplete } from './session.repository.js';

async function seedTopic() {
  const user = await seedUser();
  const [topic] = await db
    .insert(topics)
    .values({ userId: user.id, title: 'React Hooks' })
    .returning({ id: topics.id });
  if (!topic) throw new Error('topic insert returned no row');
  return { user, topic };
}

beforeEach(async () => {
  await truncateAll();
});

describe('daily session completion (T-023)', () => {
  it('is idempotent for the same local day', async () => {
    const { user, topic } = await seedTopic();

    await markSessionComplete(user.id, topic.id, '2026-09-05');
    await markSessionComplete(user.id, topic.id, '2026-09-05');

    expect(await db.select().from(sessionDays)).toHaveLength(1);
  });

  it('records two different local days separately', async () => {
    const { user, topic } = await seedTopic();

    await markSessionComplete(user.id, topic.id, '2026-09-05');
    await markSessionComplete(user.id, topic.id, '2026-09-06');

    expect(await db.select().from(sessionDays)).toHaveLength(2);
  });

  it('reports completion only for the day it was recorded', async () => {
    const { user, topic } = await seedTopic();
    await markSessionComplete(user.id, topic.id, '2026-09-05');

    expect(await isSessionComplete(user.id, topic.id, '2026-09-05')).toBe(true);
    expect(await isSessionComplete(user.id, topic.id, '2026-09-06')).toBe(false);
  });

  it('does not leak one user’s completion to another', async () => {
    const { user, topic } = await seedTopic();
    const other = await seedUser();
    await markSessionComplete(user.id, topic.id, '2026-09-05');

    expect(await isSessionComplete(other.id, topic.id, '2026-09-05')).toBe(false);
  });
});
