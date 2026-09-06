# CLAUDE.md

You are working on **learnos**. Before doing anything:

1. Read `docs/plan.md` — sections 5 and 6 at minimum.
2. Read `docs/loop.md` — this is your operating procedure. Follow it exactly.
3. Read `docs/sprint.md` — find the current sprint.
4. Open `docs/tasks.md` — pick the first `todo` task whose dependencies are `done`.

Rules that override everything else:
- **One pnpm workspace**, driven by Turborepo: three apps (`backend/`, `frontend/`, `extension/`) and two packages (`packages/shared`, `packages/ui`). TypeScript, ESM. Run `pnpm install` once, at the root. (Founder decision 2026-09-06, replacing the three-separate-repos design — see plan.md §5.)
- Backend is **Express + ws** (not Hono). Frontend uses **Redux Toolkit + RTK Query** for all API calls and state (not TanStack Query).
- `@learnos/shared` (`packages/shared`) is the only source of shared schemas/types; `@learnos/ui` (`packages/ui`) the only source of shared style tokens and mixins. There are no copies any more — import the package. `@learnos/shared` must stay browser-safe: `zod` only, never `node:*`, drizzle, postgres, bullmq, ioredis, express or ws.
- No new dependencies without a one-line reason in the commit. A dependency two apps share belongs at the same version in both — one lockfile now makes drift visible, so don't reintroduce it.
- Every task's listed test cases must be implemented and passing before it is `done`.
- Never remove a test to go green. Never edit `schema.ts` outside a schema task.
- Never ask users how they "learn best".
- Keep `tasks.md` up to date: status, notes, and new tasks for anything you discover.

Commands (from the repo root): `pnpm install` · `pnpm lint` · `pnpm test` · `pnpm build` · `pnpm check` (all three)
One app: `pnpm --filter learner-os-backend <script>` · or `cd backend && pnpm <script>`
Backend only: `pnpm db:push` · `pnpm db:test:push` · `pnpm seed` · `pnpm qa <topicId>`
Root: `docker compose up --build` · `scripts/verify.sh`

`packages/shared` is **built**, not consumed as source — the backend resolves it
with NodeNext and runs compiled JS. Turbo's `^build` handles the ordering, so
prefer `pnpm lint` / `pnpm test` at the root over running a single app's script
against a stale `packages/shared/dist`.
