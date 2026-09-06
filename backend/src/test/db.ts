// T-002 helper layer: truncate all tables in dependency order and seed a single
// user for tests that need a real DB row without depending on mock state.
import { sql } from 'drizzle-orm';
import { db, pg } from '../db/client.js';
import { users } from '../db/schema.js';
import { createSession } from '../modules/auth/auth.service.js';
import { SESSION_COOKIE } from '../modules/auth/cookie.js';

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

  if (tables.length === 0) return;

  /**
   * One statement, not one per table.
   *
   * This ran thirteen sequential TRUNCATEs — thirteen round trips before every
   * single test — and each gap between them is a window in which a request
   * still in flight from the previous test sees a half-emptied database. That
   * is the race T-100 described from the other end: the orphaned request comes
   * back 401 and it reads as a random auth flake in an unrelated test.
   *
   * Postgres truncates a list atomically, so there is no half-emptied state to
   * observe, and the window shrinks from thirteen round trips to one.
   */
  const list = tables.map(({ table_name }) => `"${table_name}"`).join(', ');
  await pg.unsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`);

  await db.execute(sql`SELECT 1;`);
}

/**
 * A real session for `userId`, as the headers a supertest request should send
 * (T-013). Suites use this instead of `x-user-id` so they exercise the same
 * auth path production does — `x-user-id` is rejected under NODE_ENV=production,
 * so a suite built on it would prove nothing about the deployed behaviour.
 */
export async function loginAs(userId: string, kind: 'web' | 'extension' = 'web') {
  const session = await createSession(userId, kind);
  return {
    token: session.token,
    cookie: `${SESSION_COOKIE}=${session.token}`,
    bearer: `Bearer ${session.token}`,
  };
}

/**
 * Inserts a user and logs them in. `cookie` is on the returned object so a test
 * can go straight to `.set('Cookie', user.cookie)` without a second await.
 */
export async function seedUser(overrides: Partial<{ email: string; name: string }> = {}) {
  const email = overrides.email ?? `user-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const name = overrides.name ?? 'Test User';

  const [user] = await db
    .insert(users)
    .values({ email, name })
    .returning({ id: users.id, email: users.email, name: users.name });

  if (!user) throw new Error('seedUser: insert returned no row');

  const { cookie, bearer } = await loginAs(user.id);
  return { ...user, cookie, bearer };
}
