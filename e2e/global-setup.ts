import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/**
 * One known dataset, and a current extension build.
 *
 * `pnpm seed` talks to Postgres directly, so this does not depend on the
 * backend being up yet and works whichever order Playwright starts things in.
 * It resets the dev learner's progress, which is what makes "4 cards due" a
 * fact rather than a hope — a suite that answers cards is not idempotent, and
 * re-running it against yesterday's state is how you get failures that mean
 * nothing.
 *
 * The extension is rebuilt rather than assumed: a stale `.output/chrome-mv3`
 * would test code nobody is running, and that is worse than not testing it.
 */
export default function globalSetup() {
  if (!existsSync(`${root}/backend/.env`)) {
    throw new Error('e2e: backend/.env is missing — copy backend/.env.example and fill it in.');
  }

  console.log('\n[e2e] seeding the dev dataset…');
  execFileSync('pnpm', ['--filter', 'learner-os-backend', 'seed'], { cwd: root, stdio: 'inherit' });

  console.log('[e2e] building the extension…');
  execFileSync('pnpm', ['--filter', 'learner-os-extension', 'build'], { cwd: root, stdio: 'inherit' });
}
