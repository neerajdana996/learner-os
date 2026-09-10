/**
 * `pnpm revoke-token <raw-token>` — revokes one session by its raw token
 * (E2E-006).
 *
 * There is no HTTP route for this: `POST /auth/logout` only ever reads the
 * session *cookie* (`auth.controller.ts`), never an `Authorization: Bearer`
 * header, so an extension token has no way to be revoked over the API today.
 * This exists purely so an E2E test can put a previously-valid extension
 * token into a genuinely revoked state without reaching into the database
 * from the test file itself.
 */
import { fileURLToPath } from 'node:url';
import { hashToken } from '../lib/token.js';
import { revokeSession } from '../modules/auth/auth.repository.js';
import { pg } from '../db/client.js';
import { env } from '../lib/env.js';
import { isLocalDatabase } from './seed.js';

async function main(): Promise<void> {
  if (!isLocalDatabase(env.DATABASE_URL) && process.env.SEED_FORCE !== '1') {
    console.error(`revokeExtensionToken: refusing to run against ${new URL(env.DATABASE_URL).hostname}.`);
    process.exit(1);
  }

  const raw = process.argv[2];
  if (!raw) {
    console.error('usage: pnpm revoke-token <raw-token>');
    process.exit(1);
  }

  const revoked = await revokeSession(hashToken(raw), new Date());
  if (revoked.length === 0) {
    console.error('revokeExtensionToken: no matching session (already revoked, or wrong token)');
    process.exit(1);
  }
  console.log('revokeExtensionToken: revoked');
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  await main();
  await pg.end();
}
