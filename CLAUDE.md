# CLAUDE.md

You are working on **learnos**. Before doing anything:

1. Read `docs/plan.md` — sections 5 and 6 at minimum.
2. Read `docs/loop.md` — this is your operating procedure. Follow it exactly.
3. Read `docs/sprint.md` — find the current sprint.
4. Open `docs/tasks.md` — pick the first `todo` task whose dependencies are `done`.

Rules that override everything else:
- Three plain projects (`backend/`, `frontend/`, `extension/`), NOT a monorepo. TypeScript, ESM, pnpm per project.
- Backend is **Express + ws** (not Hono). Frontend uses **Redux Toolkit + RTK Query** for all API calls and state (not TanStack Query).
- `backend/src/shared/` is the only source of shared schemas/types. After editing it, run `scripts/sync-shared.sh`. Never hand-edit the synced copies.
- No new dependencies without a one-line reason in the commit.
- Every task's listed test cases must be implemented and passing before it is `done`.
- Never remove a test to go green. Never edit `schema.ts` outside a schema task.
- Never ask users how they "learn best".
- Keep `tasks.md` up to date: status, notes, and new tasks for anything you discover.

Commands (run inside a project): `pnpm install` · `pnpm lint` · `pnpm test` · `pnpm dev`
Backend only: `pnpm db:push` · `pnpm db:test:push` · `pnpm seed` · `pnpm qa <topicId>`
Root: `docker compose up --build` · `scripts/sync-shared.sh` · `scripts/verify.sh` · `scripts/create-github-repos.sh`
