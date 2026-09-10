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

  // A second, throwaway user with zero topics (E2E-002) — onboarding's own
  // spec needs "brand new, no topic yet", and getting there by destructively
  // resetting dev@learnos.local would break every other spec file in this
  // project that assumes it already has a taught topic.
  console.log('[e2e] seeding a fresh topic-less user…');
  execFileSync('pnpm', ['--filter', 'learner-os-backend', 'seed:fresh'], { cwd: root, stdio: 'inherit' });

  // Two users with a diagnostic-ready topic (E2E-003) — no real generation,
  // same reasoning as the fresh-user seed above.
  console.log('[e2e] seeding diagnostic-ready topics…');
  execFileSync('pnpm', ['--filter', 'learner-os-backend', 'seed:diagnostic'], { cwd: root, stdio: 'inherit' });

  // Two more users for the session-completion states (E2E-004) — completing
  // a session against dev@learnos.local would mark *today* complete for every
  // other spec that assumes an always-in-progress session.
  console.log('[e2e] seeding session-completion topics…');
  execFileSync('pnpm', ['--filter', 'learner-os-backend', 'seed:session'], { cwd: root, stdio: 'inherit' });

  // A topic with all four ConceptStates and an atRisk concept at once
  // (E2E-005) — pnpm seed's own dev topic never produces a `known` concept.
  console.log('[e2e] seeding a map fixture…');
  execFileSync('pnpm', ['--filter', 'learner-os-backend', 'seed:map'], { cwd: root, stdio: 'inherit' });

  console.log('[e2e] building the extension…');
  execFileSync('pnpm', ['--filter', 'learner-os-extension', 'build'], { cwd: root, stdio: 'inherit' });
}
