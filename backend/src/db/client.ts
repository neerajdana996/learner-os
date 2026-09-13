// Plan for T-002: make one shared Postgres client for Drizzle tests and app code,
// then add a `truncateAll()` helper and seeded-user utility. This is the DB layer
// each later persistence task will reuse.
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { env } from '../lib/env.js';
import * as schema from './schema.js';

// TLS follows `sslmode` in DATABASE_URL, never NODE_ENV. Keying it off NODE_ENV
// once took production down completely: the managed Postgres had SSL off, so
// `require` aborted every connection during negotiation while /health, which
// touches no database, stayed green. `prefer` encrypts when the server offers
// TLS and falls back when it doesn't, so neither end can strand the other.
function sslMode(url: string) {
  const mode = new URL(url).searchParams.get('sslmode');
  if (mode === 'disable') return false;
  if (mode === 'require' || mode === 'allow' || mode === 'verify-full') return mode;
  return 'prefer' as const;
}

export const pg = postgres(env.DATABASE_URL, {
  max: 10,
  ssl: sslMode(env.DATABASE_URL),
  // Quiets routine "truncate cascades to table ..." NOTICEs from truncateAll() in tests.
  onnotice: env.NODE_ENV === 'test' ? () => {} : undefined,
});

export const db = drizzle(pg, { schema });
