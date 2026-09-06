/**
 * `pnpm preflight` — checks the things the test suite structurally cannot.
 *
 * Every test mocks `openai`, runs against `learnos_test`, and never reads
 * `.env`. That is correct for tests and it is exactly why a green suite has
 * repeatedly coexisted with an app that would not start: a missing `.env`, an
 * SDK that throws at import, a provider taking 164s per call, and a dev
 * database silently behind `schema.ts` were all invisible to it.
 *
 * This talks to the real environment and says plainly what is wrong. Run it
 * before `pnpm dev`, and whenever something behaves oddly. (Named preflight, not doctor: `pnpm doctor` is one of pnpm's own commands and would shadow it.)
 */
import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import { Redis } from 'ioredis';
import { env } from '../lib/env.js';
import * as schema from '../db/schema.js';

type Status = 'ok' | 'warn' | 'fail';
const results: { name: string; status: Status; detail: string }[] = [];

function record(name: string, status: Status, detail: string) {
  results.push({ name, status, detail });
  const icon = status === 'ok' ? '✅' : status === 'warn' ? '⚠️ ' : '❌';
  console.log(`${icon} ${name.padEnd(22)} ${detail}`);
}

/**
 * Presence and length only — never any of the value.
 *
 * A prefix is tempting for telling two keys apart, but preflight output ends up
 * pasted into chats and issues, and a partial credential is still a credential.
 * Length is enough to spot a truncated paste, which is the realistic mistake.
 */
function mask(value: string): string {
  return value ? `(set, ${value.length} chars)` : '(empty)';
}

async function checkPostgres(url: string, label: string): Promise<postgres.Sql | null> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`select 1`;
    record(label, 'ok', url.replace(/:[^:@]*@/, ':***@'));
    return sql;
  } catch (error) {
    record(label, 'fail', `unreachable — ${(error as Error).message}`);
    await sql.end().catch(() => {});
    return null;
  }
}

/**
 * Compares `schema.ts` against what is actually in the database.
 *
 * `drizzle-kit push` printing "Changes applied" is not proof the schema is
 * live — a container that restarts onto a fresh volume takes the migrations
 * with it, and the next symptom is a 401 from an unrelated route.
 */
async function checkSchema(sql: postgres.Sql, label: string): Promise<void> {
  // `is(..., PgTable)` rather than a duck-typed check: the module also exports
  // pgEnums, which would otherwise be mistaken for tables.
  const tables = Object.values(schema).filter((value) => is(value, PgTable));

  const rows = await sql<{ table_name: string; column_name: string }[]>`
    select table_name, column_name from information_schema.columns
    where table_schema = 'public'
  `;
  const live = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!live.has(row.table_name)) live.set(row.table_name, new Set());
    live.get(row.table_name)?.add(row.column_name);
  }

  const missing: string[] = [];
  for (const table of tables) {
    const config = getTableConfig(table as PgTable);
    const liveColumns = live.get(config.name);
    if (!liveColumns) {
      missing.push(`table ${config.name}`);
      continue;
    }
    for (const column of config.columns) {
      if (!liveColumns.has(column.name)) missing.push(`${config.name}.${column.name}`);
    }
  }

  if (missing.length === 0) {
    record(label, 'ok', `${tables.length} tables match schema.ts`);
  } else {
    record(label, 'fail', `${missing.length} missing — run pnpm db:push. First: ${missing.slice(0, 4).join(', ')}`);
  }
}

async function checkRedis(): Promise<void> {
  const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    await redis.ping();
    record('redis', 'ok', env.REDIS_URL);
  } catch (error) {
    record('redis', 'fail', `unreachable — ${(error as Error).message}`);
  } finally {
    redis.disconnect();
  }
}

/**
 * A real round trip, because "the key is set" has never been the failure.
 * The failures were a provider taking 164s and an SDK that threw at import.
 */
async function checkLlm(): Promise<void> {
  if (!env.OPENAI_API_KEY) {
    record('llm', 'warn', 'OPENAI_API_KEY empty — generation will fail, everything else works');
    return;
  }

  const { complete } = await import('../llm/index.js');
  const { MODELS } = await import('../llm/models.js');
  const started = Date.now();
  try {
    await complete({
      system: 'Reply with only JSON.',
      user: 'Return {"ok":true}',
      model: MODELS.gradeExplanation.model,
      reasoningEffort: 'none',
      maxTokens: 32,
    });
    const seconds = (Date.now() - started) / 1000;
    // Grading sits in the request path with a learner waiting, so slow here is
    // a product problem, not just a build annoyance.
    const status = seconds > 10 ? 'warn' : 'ok';
    record('llm', status, `${MODELS.gradeExplanation.model} round trip ${seconds.toFixed(1)}s${status === 'warn' ? ' — too slow for in-request grading' : ''}`);
  } catch (error) {
    record('llm', 'fail', `${(error as Error).message.slice(0, 120)}`);
  }
}

async function checkMail(): Promise<void> {
  if (!env.SMTP_HOST) {
    record('mail', 'ok', 'console transport (magic links printed to stdout)');
    return;
  }
  const nodemailer = (await import('nodemailer')).default;
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  try {
    // Authenticates without sending, so running doctor never mails anyone.
    await transport.verify();
    record('mail', 'ok', `${env.SMTP_HOST}:${env.SMTP_PORT} as ${env.MAIL_FROM}`);
  } catch (error) {
    record('mail', 'fail', `${(error as Error).message.slice(0, 120)}`);
  }
}

function checkOAuth(): void {
  const providers = [
    ['google', env.GOOGLE_CLIENT_ID],
    ['github', env.GITHUB_CLIENT_ID],
  ] as const;
  const configured = providers.filter(([, id]) => id).map(([name]) => name);
  record(
    'oauth',
    'ok',
    configured.length > 0 ? `${configured.join(', ')} (magic link always available)` : 'magic link only',
  );
}

async function main(): Promise<void> {
  console.log(`\nlearnos preflight — NODE_ENV=${env.NODE_ENV}\n`);
  record('env file', 'ok', `OPENAI_API_KEY=${mask(env.OPENAI_API_KEY)} SMTP_PASS=${mask(env.SMTP_PASS)}`);

  const dev = await checkPostgres(env.DATABASE_URL, 'postgres (dev)');
  if (dev) {
    await checkSchema(dev, 'schema (dev)');
    await dev.end();
  }

  const testUrl = process.env.TEST_DATABASE_URL ?? env.DATABASE_URL.replace(/\/[^/]+$/, '/learnos_test');
  const test = await checkPostgres(testUrl, 'postgres (test)');
  if (test) {
    await checkSchema(test, 'schema (test)');
    await test.end();
  }

  await checkRedis();
  checkOAuth();
  await checkMail();
  await checkLlm();

  const failed = results.filter((r) => r.status === 'fail');
  console.log(
    failed.length === 0
      ? '\nAll checks passed.\n'
      : `\n${failed.length} check(s) failed: ${failed.map((f) => f.name).join(', ')}\n`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

await main();
