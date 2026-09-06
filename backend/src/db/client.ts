// Plan for T-002: make one shared Postgres client for Drizzle tests and app code,
// then add a `truncateAll()` helper and seeded-user utility. This is the DB layer
// each later persistence task will reuse.
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { env } from '../lib/env.js';
import * as schema from './schema.js';

export const pg = postgres(env.DATABASE_URL, {
  max: 10,
  ssl: env.NODE_ENV === 'production' ? 'require' : undefined,
  // Quiets routine "truncate cascades to table ..." NOTICEs from truncateAll() in tests.
  onnotice: env.NODE_ENV === 'test' ? () => {} : undefined,
});

export const db = drizzle(pg, { schema });
