import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { users } from '../../db/schema.js';

export async function findUserById(id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user ?? null;
}

export async function updateUser(
  id: string,
  values: Partial<{ name: string | null; timezone: string; activeWindows: unknown }>,
) {
  const [user] = await db.update(users).set(values).where(eq(users.id, id)).returning();
  if (!user) throw new Error('user update returned no row');
  return user;
}
