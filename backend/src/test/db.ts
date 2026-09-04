// T-002 helper layer: truncate all tables in dependency order and seed a single
// user for tests that need a real DB row without depending on mock state.
import { sql } from 'drizzle-orm';
import { db, pg } from '../db/client.js';
import { users } from '../db/schema.js';

export async function truncateAll(): Promise<void> {
  // table_type filter matters: information_schema.tables also lists views, and
  // TRUNCATE on a view errors out, which would fail every DB test.
  const tables = await pg<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name NOT LIKE 'drizzle_%'
    ORDER BY table_name DESC;
  `;

  for (const { table_name } of tables) {
    await pg.unsafe(`TRUNCATE TABLE "${table_name}" RESTART IDENTITY CASCADE;`);
  }

  await db.execute(sql`SELECT 1;`);
}

export async function seedUser(overrides: Partial<{ email: string; name: string }> = {}) {
  const email = overrides.email ?? `user-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const name = overrides.name ?? 'Test User';

  const [user] = await db
    .insert(users)
    .values({ email, name })
    .returning({ id: users.id, email: users.email, name: users.name });

  if (!user) throw new Error('seedUser: insert returned no row');
  return user;
}
