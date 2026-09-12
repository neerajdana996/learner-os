/**
 * `pnpm db:reset` — empty the local Postgres and Redis completely.
 *
 * Distinct from `resetUser` (`lib/reset.ts`), which clears one learner and is
 * reachable from the running app. This clears *everything*: every user, topic,
 * concept, item, card and review event, plus every BullMQ queue, job and rate
 * limit key in Redis. It is the "start the flow from nothing" button, for when
 * you want to watch a real generation against an empty database rather than
 * one carrying three weeks of fixtures and half-finished experiments.
 *
 * Two safeguards, both deliberate:
 *
 * 1. **Local unless told otherwise.** Both URLs are checked against the same
 *    host allowlist `pnpm seed` uses. A remote target needs `--allow-remote`
 *    *and* `--yes`, and the host is printed before anything is touched — the
 *    hosted Postgres and Redis are reachable from any developer's `.env`, and
 *    one absent-minded `pnpm db:reset` should not be able to empty them.
 * 2. **Dry run by default.** With no `--yes` it prints what it would destroy
 *    and stops. The counts are the point — a script that silently empties a
 *    database you meant to keep is worse than one extra flag.
 *
 * The schema itself is left alone. `TRUNCATE` empties the tables drizzle-kit
 * pushed; it does not drop them, so the app is immediately usable afterwards
 * and no `db:push` is needed.
 */
import { Redis } from 'ioredis';
import { pg } from '../db/client.js';
import { env } from '../lib/env.js';
import { isLocalDatabase } from './seed.js';

/** Same allowlist as the database guard: compose service names count as local. */
function isLocalRedis(url: string): boolean {
  const host = new URL(url).hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === 'redis';
}

interface TableCount {
  table: string;
  rows: number;
}

/**
 * Row counts per table, exact rather than from `pg_stat_user_tables` — the
 * statistics view is approximate and lags, and an operator deciding whether to
 * pass `--yes` is entitled to a number that is actually true.
 */
export async function tableCounts(): Promise<TableCount[]> {
  const tables = await pg<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name NOT LIKE 'drizzle_%'
    ORDER BY table_name;
  `;

  const counts: TableCount[] = [];
  for (const { table_name } of tables) {
    const [row] = await pg.unsafe<{ count: string }[]>(`SELECT count(*)::text AS count FROM "${table_name}";`);
    counts.push({ table: table_name, rows: Number(row?.count ?? 0) });
  }
  return counts;
}

/** One statement for every table, for the reason `test/db.ts` documents: a
 *  sequence of truncates leaves observable half-emptied states in between. */
export async function truncateEverything(tables: string[]): Promise<void> {
  if (tables.length === 0) return;
  const list = tables.map((table) => `"${table}"`).join(', ');
  await pg.unsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`);
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--yes');
  const allowRemote = process.argv.includes('--allow-remote');

  const dbHost = new URL(env.DATABASE_URL).hostname;
  const redisHost = new URL(env.REDIS_URL).hostname;
  const remote = !isLocalDatabase(env.DATABASE_URL) || !isLocalRedis(env.REDIS_URL);

  if (remote && !allowRemote) {
    throw new Error(
      `refusing to empty a remote target without --allow-remote: postgres ${dbHost}, redis ${redisHost}`,
    );
  }
  if (remote) {
    console.log(`\n⚠  REMOTE TARGET — postgres ${dbHost}, redis ${redisHost}`);
  }

  const before = await tableCounts();
  const totalRows = before.reduce((sum, { rows }) => sum + rows, 0);

  console.log(`\npostgres  ${new URL(env.DATABASE_URL).pathname.slice(1)} — ${totalRows} rows across ${before.length} tables`);
  for (const { table, rows } of before.filter(({ rows }) => rows > 0)) {
    console.log(`  ${table.padEnd(20)} ${rows}`);
  }

  /**
   * Opened and closed around each Redis step rather than held for the whole
   * run. A hosted Redis (Upstash) drops an idle TLS connection, ioredis emits
   * that as an `error` event, and an unhandled `error` event is a hard crash —
   * which took the process down *mid-TRUNCATE*, rolling the Postgres half back
   * while reporting a Redis failure. The handler below is the belt; opening
   * late is the braces.
   */
  const withRedis = async <T>(fn: (redis: Redis) => Promise<T>): Promise<T> => {
    const redis = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 5_000,
      // Give up instead of reconnecting forever. A Redis that is out of quota
      // refuses every connection, and the default strategy retries for ever —
      // the script hangs with nothing printed rather than saying so.
      retryStrategy: () => null,
    });
    redis.on('error', (error) => console.error(`redis: ${error.message}`));
    await redis.connect();
    try {
      return await fn(redis);
    } finally {
      await redis.quit().catch(() => redis.disconnect());
    }
  };

  /**
   * Redis is reported, never fatal. Postgres is what this script is for, and a
   * Redis that is down, rate-limited or out of quota must not be able to stop
   * the database half — the first run against the hosted pair died on an
   * Upstash quota error *after* Postgres was already emptied, which is the
   * worst of both outcomes to report.
   */
  const redisStep = async <T>(label: string, fn: (redis: Redis) => Promise<T>): Promise<T | null> => {
    try {
      return await withRedis(fn);
    } catch (error) {
      console.error(`redis     ${label} failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };

  const keysBefore = await redisStep('dbsize', (redis) => redis.dbsize());
  if (keysBefore !== null) console.log(`redis     ${keysBefore} keys`);

  if (!apply) {
    console.log('\nnothing was deleted. Re-run with --yes to empty both.\n');
    return;
  }

  await truncateEverything(before.map(({ table }) => table));
  const after = await tableCounts();
  const rowsAfter = after.reduce((sum, { rows }) => sum + rows, 0);

  const keysAfter = await redisStep('flushall', async (redis) => {
    await redis.flushall();
    return redis.dbsize();
  });

  console.log(
    `\nemptied. postgres ${rowsAfter} rows, redis ${keysAfter === null ? 'NOT CLEARED (see error above)' : `${keysAfter} keys`}.`,
  );
  console.log('The schema is intact — no db:push needed. `pnpm seed` rebuilds a dev dataset.\n');
}

// Only when run as a script, so the tests can import the helpers above without
// emptying a database and closing the shared pool underneath the suite.
const invokedDirectly = process.argv[1]?.endsWith('resetDb.ts') || process.argv[1]?.endsWith('resetDb.js');
if (invokedDirectly) {
  await main();
  await pg.end();
}
