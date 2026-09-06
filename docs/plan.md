# plan.md — learnos

> Read this first. It's the "why" and the "what". `loop.md` is the "how you work", `sprint.md` is the "when", `tasks.md` is the "what exactly".

## 1. One-line vision
A platform that guarantees you'll **remember** what you learn. Not "learn" — remember. We prove it with a surprise test on day 30 — three weeks after the teaching stopped.

## 2. The pilot we are building for
- 10 people from the founder's network, 1 topic each. **Seven days of teaching, then silence, then one cold test on day 30.**
  > **Changed 2026-09-06 (founder decision), replacing "30 days" of teaching with tests on day 30 and day 45.** The measurement did not move; the *ask* did, from thirty days of daily work to one week. Dropout is the real threat to a ten-person pilot, and this both shortens the commitment and *lengthens* the gap before the test, from nothing to twenty-three days. That gap is the whole measurement: the literature is unambiguous that a test at the end of a course flatters cramming, and that spacing only wins on delayed tests (Cepeda et al., 317 experiments — the effect emerges after weeks). The day-45 test is dropped rather than kept: it existed to separate "still practising" from "cold", and with twenty-three days of silence the day-30 test is already cold.
- Two surfaces: a **web app** (teaching, ~10 min/day) and a **Chrome extension** (retrieval, one question per pop-up, ~20 sec each).
- Success = Day-30 retention on taught concepts jumps vs. Day-0, and held-out (untaught) concepts stay flat. Both measured cold, twenty-three days after the last session.

## 3. What the research says (and we obey)
1. **Learning styles (visual/auditory/kinesthetic) matching does not work.** We never ask users how they learn. We infer from behaviour.
2. What actually works, in order of effect size: **retrieval practice, spaced repetition, feedback, mastery gating, cognitive-load management.** The product is these five things, made painless.
3. **Prior knowledge is the #1 predictor.** Diagnose first, teach only the gap.
4. **Novices need worked examples; experts need problems** (expertise reversal). We A/B this per concept and let data decide.
5. **Productive failure** (try before being told) improves conceptual understanding (g≈0.36). Every new concept starts with a try-first prompt.
6. **Self-report is unreliable** (illusions of competence). We collect confidence ratings to measure calibration, not to trust them.
7. **Extrinsic rewards (coupons) undermine motivation.** Points = knowledge score that only rises on delayed correct recall. No coupons.

## 4. Product surfaces

### Web app
- Onboarding: name/email/timezone/active windows → topic + why + timeline (≥7 days) + daily budget → adaptive diagnostic (~15 items, with confidence taps) → concept map coloured green/yellow/grey → "Start".
- Today's session: 1–3 new concepts (try-first → feedback → explanation → one retrieval question), then due reviews.
- Map: concept graph coloured by mastery; "at risk this week" highlighted.
- Knowledge score: visible everywhere; rises only on correct recall after ≥1 day gap; decays with predicted forgetting.
- Tests: Day-0 (diagnostic) and a Day-30 surprise cold test. Nothing between day 8 and day 30 — no cards, no sessions, no reminders.

### Chrome extension
- One question card, from the due queue. Never teaches new concepts.
- Answer → instant right/wrong + one-line explanation → optional confidence tap → closes.
- Respects active windows and daily cap. 3 dismissals in a row → back off for the day.
- Once a day: mood tap (1/2/3).
- Offline queue, sync when online.

## 5. Architecture (decided — do not re-litigate)
**One pnpm workspace**, orchestrated by Turborepo: three apps and two shared packages, each with its own `package.json`, `tsconfig.json` and tests, and one lockfile at the root. A root `docker-compose.yml` starts everything together.

> **Changed 2026-09-06 (founder decision), replacing "three independent projects, no monorepo".** The original reasoning was that a package "would buy per-project version pinning, and drift between the web app and the extension is the failure this prevents". That argument does not survive contact with pnpm: `workspace:*` gives *less* version independence than three lockfiles, not more, because there is exactly one resolved copy. And the three lockfiles were already hiding real drift — `@testing-library/jest-dom` at `^6.6.3` in the frontend and `^6.9.1` in the extension, and an extension-only `vite: ^7.3.6` override against the frontend's `vite: ^6.3.5`. Eight of the seventeen commits outstanding at migration time existed only to sync copied files. The real cost of a workspace is build complexity (Docker contexts, WXT resolution), not version drift; that cost was paid once and is documented in the Dockerfiles.

```
learnos/
├── docker-compose.yml    postgres, redis, backend, frontend (extension is built, not served)
├── CLAUDE.md
├── docs/                 plan.md, loop.md, sprint.md, tasks.md, api.md, ...
├── pnpm-workspace.yaml   the five packages, plus allowBuilds
├── turbo.json            the task graph — `^build` is the one edge that matters
├── .github/workflows/    ci.yml — lint, test, build on real Postgres + Redis
├── packages/
│   ├── shared/           @learnos/shared — Zod schemas + TS types (SOURCE OF TRUTH for all three apps). BUILT: emits dist/*.js + *.d.ts.
│   └── ui/               @learnos/ui — the design system: colour tokens, scale, mixins, and every presentational component both clients share. styles/ is SCSS; src/ is BUILT.
├── backend/              Express + ws (WebSocket) + Drizzle (Postgres) + BullMQ (Redis). Port 3001.
│   ├── Dockerfile        (build context is the REPO ROOT)
│   ├── src/db/           schema.ts (SOURCE OF TRUTH), client.ts
│   ├── src/scheduler/    ts-fsrs wrapper: scheduleReview, newCard, predictedRecall
│   ├── src/llm/          one model client + file-based prompts (prompts/<name>/*.md) + typed registry (runPrompt → JSON → Zod). All model calls go through here. (T-050)
│   ├── src/generator/    thin callers of src/llm: generateConceptMap, generateItems (strict JSON via Zod)
│   ├── src/routes/  src/workers/  src/lib/  src/scripts/
│   └── fixtures/         real-looking LLM outputs for tests
├── frontend/             React + Vite + Redux Toolkit (RTK Query for ALL API calls + state) + react-router. Port 3000.
│   └── Dockerfile        (vite build → nginx; context is the REPO ROOT)
└── extension/            WXT + React (Manifest V3).
    └── Dockerfile        (builds the zip into ./dist; context is the REPO ROOT)
```
- **TypeScript everywhere. ESM. One pnpm workspace, one lockfile, `pnpm install` at the root.**
- **Shared code rule:** `packages/shared` is the only place shared schemas/types are written; `packages/ui` the only place shared presentation is written (T-090). Both are imported as packages — `@learnos/shared` and `@learnos/ui` — and there are no copies to keep in step. `@learnos/shared` must stay **browser-safe** (only `zod`; never `node:*`, drizzle, postgres, bullmq, ioredis, express or ws): it is compiled by Vite for the web app and by WXT for the extension, and neither has Node. Two guards enforce this — a smoke test in each client (`src/shared.test.ts`) and a grep in CI.
- **`packages/shared` is built, not consumed as source.** The backend resolves with NodeNext and runs `node dist/index.js`, so it needs real emitted JS. That is the single ordering constraint in the repo and the reason Turborepo is here: `"build": { "dependsOn": ["^build"] }`.
- **Sass has no node resolution.** Both clients set a scss `loadPaths` at their own `node_modules`, which is where pnpm links `@learnos/ui`. That is why `@use "@learnos/ui/styles/variables"` resolves.
- **No Qdrant, no LangChain/LangGraph.** Generation is prompt → JSON → Zod → DB.
- **Postgres tables:** users, topics, concepts, concept_prereqs, items, cards (FSRS state per user×concept), review_events (every answer), tests, daily_pulse. Schema lives at `backend/src/db/schema.ts`.
- **Auth for pilot:** magic link (email). `x-user-id` header is a dev shortcut only.
- **LLM provider:** **NVIDIA's OpenAI-compatible endpoint** (`https://integrate.api.nvidia.com/v1`), reached with the official `openai` SDK — a different `baseURL`, not a different client library. Model `deepseek-ai/deepseek-v4-pro-0813`, set as `DEFAULT_MODEL` in `backend/src/llm/client.ts`; per-prompt overrides via `PromptDef.model`. Auth via `NVIDIA_API_KEY`. (Founder decision 2026-09-04, replacing the Anthropic/`claude-sonnet-5` pin from T-050 — an OpenAI-compatible endpoint keeps the door open to swapping models by config alone. LangChain is still ruled out: `ChatNVIDIA` only wraps this same HTTP API.) All model calls go through the `backend/src/llm` module (file-based prompts + typed registry, T-050). Every generated artifact is Zod-validated; failures retry once then fail the job loudly.
- **Run everything:** `docker compose up --build`. Run one project for dev: `cd backend && pnpm dev` (needs `docker compose up postgres redis`).

## 6. Key design rules
- `concepts.held_out = true` → never taught, never reviewed, only appears in tests. ~10% of concepts, random, excluding the first 3 in order.
- `concepts.teach_mode` → randomised `try_first` / `example_first` per concept at generation. Session UI must respect it.
- `review_events.predicted_recall` → what FSRS believed **before** the question was shown. Always written. This is how we check scheduler calibration.
- `review_events.gap_days_since_last` → always written. "Did it stick" = correct with gap ≥ 1.
- Knowledge score for a concept = `predictedRecall(card)`. Topic score = mean over taught concepts.
- Extension never shows a concept the user hasn't been taught on web (`cards.taughtAt IS NOT NULL`).
- Daily new-concept load = ceil(remaining_untaught / remaining_days), capped so session ≤ daily budget.

## 7. Metrics the code must make possible (see tasks T-040..T-045)
- Retention gain: Day-30 − Day-0, per concept and overall, taught vs. held-out. This *is* the durability measure now: day 30 sits twenty-three days after the last review, so there is no separate Day-45 ratio to compute.
- Transfer: accuracy on `items.is_transfer = true`.
- Calibration gap: confidence − accuracy, Day-0 vs. Day-30.
- Scheduler calibration: mean(predicted_recall) vs. mean(correct) in bins.
- Teach-mode comparison: delayed recall on try_first vs. example_first concepts per user.
- Extension: answer rate, snooze rate, dismiss rate, median latency.

## 8. Out of scope for the pilot
Multi-topic scheduling, social features, payments, mobile app, personalised FSRS parameters (use defaults), any recommendation/feed, coupons.

## 9. Glossary
- **Concept** — atomic learnable unit (node in the map).
- **Item** — a question about a concept. Types: recall, recognition, application, explain.
- **Card** — per-user FSRS memory state for one concept.
- **Review event** — one answer/skip/dismiss, anywhere.
- **Held-out** — control concept, never taught.
- **Taught** — concept the user completed a session for (`cards.taughtAt` set).
