# loop.md — how to work on learnos

> This is the operating procedure. Follow it every session, every task. It exists so a model with limited context can still ship correct code.

## 0. Session start (every time)
1. Read `plan.md` sections 5 and 6 (architecture + design rules). Don't skip.
2. Read `sprint.md` to find the current sprint.
3. Open `tasks.md`. Find the **first task with status `todo` whose `depends_on` are all `done`**. That is your task. Do not pick a later one because it looks more interesting.
4. From the repo root, run `pnpm install && pnpm lint`. One install covers the whole workspace. If it fails, fixing it is your task now (log it as a new task `T-FIX-xxx`).
5. If the task touches `packages/shared` or `packages/ui`, every app feels it immediately — there are no copies to sync, so run `pnpm test` at the root rather than in one app.

## 1. Before writing code
- Read the task's **Description, Acceptance criteria, Test cases, Files** in full.
- Open every file listed under **Files**. Read `backend/src/db/schema.ts` if the task touches data.
- Write a 3–6 line plan as a comment at the top of your work (or in the task's `notes` field). If the plan needs a schema change, stop and add the migration as its own step first.
- If something in the task contradicts `plan.md`, `plan.md` wins. Note the contradiction in the task's `notes`.

## 2. Writing code
- Small commits. One task = one branch `task/T-xxx-short-name`.
- Types from `@learnos/shared` (`packages/shared`). Never write a Zod schema anywhere else. It must stay browser-safe: `zod` only, never `node:*`, drizzle, postgres, bullmq, ioredis, express or ws.
- No `any`. No `// @ts-ignore`. If you must, write why in the same line.
- Every API route validates input with the `validate()` middleware (`backend/src/lib/validate.ts`) and a schema from `@learnos/shared`. WebSocket messages are validated the same way.
- Every write to `review_events` must set `predicted_recall` and `gap_days_since_last` (see plan §6).
- Never call the model API from the web app or extension. Only `backend/src/generator`, only from a BullMQ worker.
- UI: plain React. **Zero inline styles** — SCSS classes under `frontend/src/styles/`, components take `className`. Colour tokens, the spacing/type scale and the shared mixins live in `@learnos/ui` (`packages/ui/styles/`) and are imported as `@use "@learnos/ui/styles/variables"`; never re-declare a colour or a spacing value in a component partial.
- **No UI library on the client. Decided, not open** (T-081, founder call 2026-09-06). This covers component kits *and* editor/renderer packages: CodeMirror, Monaco, a drag library, a graph library. `codeEditor` (T-088) is a plain `<textarea>` with tab and indent handling.
  - The reason it is not a close call: T-088's own design already turns off **autocomplete, inline type hints and squiggles**, because each is a retrieval cue and retrieval is the thing being measured. What CodeMirror would still contribute is bracket matching and indent-on-newline — about thirty lines of `keydown` — plus syntax highlighting, which is itself arguably a cue, since a keyword that fails to colour is feedback the design says should not be there. That is a very small return for a large dependency on one block, on one screen.
  - Blast radius was already tiny: `codeEditor` is barred from the extension (T-089, too slow) and from the Day-30 test (T-093), so it appears only in a web session.
  - **Revisiting is cheap and additive** — the data contract does not change. If pilot participants struggle with a bare textarea, that is evidence, and evidence can overturn this.
  - ⚠ **This does not settle `graphBuild`** (T-108, deferred). A textarea cannot substitute for drawing a graph, so that block needs its own decision — a canvas, or a non-drawing answer format — when it is picked up. Do not read this line as permission.
- Frontend data: **all** API calls go through RTK Query (`frontend/src/store/api.ts`); all client state lives in Redux Toolkit slices. No `fetch`/`axios` in components.

## 3. Testing (mandatory, not optional)
- Test runner: **vitest**, installed per project. Tests live next to the code: `foo.test.ts`.
- Implement **every** test case listed in the task. Add more if you find edge cases; never remove one.
- API tests hit a real Postgres (`docker compose up -d`), using a `learnos_test` database. Truncate tables in `beforeEach`.
- Generator tests: mock at the SDK boundary (`openai.chat.completions.create`); never hit the network in tests. Include one fixture of real-looking JSON output per prompt in `backend/fixtures/`.
- Scheduler tests: pure functions, no mocks.
- Run `pnpm test` inside every project you touched. All green before you move on.

## 4. Definition of done (all must be true)
- [ ] All acceptance criteria met — check each one explicitly, don't assume.
- [ ] All listed test cases implemented and passing.
- [ ] `pnpm lint` and `pnpm test` pass **from the repo root** — Turbo runs them everywhere and builds `@learnos/shared` first, which a single app's script will not do.
- [ ] If you changed `packages/shared` or `packages/ui`, you ran the root suites: a change there lands in all three apps at once.
- [ ] If you touched a stylesheet, `pnpm build` passed in that project — `pnpm lint` is `tsc --noEmit` and never compiles SCSS, so a broken `@use` path passes lint (T-090).
- [ ] If the task adds a route: it's in `backend/src/index.ts` and there is a `curl` example in the task's `notes`.
- [ ] If the task adds a page: it's in `frontend/src/App.tsx` routes.
- [ ] No TODO left in the code without a task ID next to it (`// TODO(T-031): ...`).

## 5. Closing the task
1. Set `status: done` in `tasks.md`. Fill `notes` with: what you built, what you deliberately skipped, anything the next task needs to know.
2. If you discovered work that isn't in `tasks.md`, **add it as a new task** with the same format (status `todo`, a sprint, dependencies, tests). Do not silently do extra work.
3. Commit: `T-xxx: <one-line summary>`.
4. Go back to step 0. Next task.

## 6. When you're stuck
- Stuck > 20 minutes on one error: write what you tried in the task's `notes`, set `status: blocked`, and move to the next unblocked task.
- Never delete a test to make the suite green.
- Never change `schema.ts` to make a test pass unless the task is a schema task.
- If a library API doesn't match what the task assumes, check the installed version in `node_modules` and adapt; note the version in `notes`.

## 7. Things you must not do
- Don't add dependencies without a one-line justification in the commit message.
- Don't rewrite files you weren't asked to touch. Refactors are their own tasks.
- Don't add a third shared package without a reason in the commit. Two is the whole surface: the API contract and the design tokens.
- Don't build ahead of the sprint. Sprint 1 is the foundation; if it's tempting to build the map UI in Sprint 1, don't.
- Don't ask the user how they "learn best". Ever. (plan §3.1)
