# plan.md — learnos

> Read this first. It's the "why" and the "what". `loop.md` is the "how you work", `sprint.md` is the "when", `tasks.md` is the "what exactly".

## 1. One-line vision
A platform that guarantees you'll **remember** what you learn. Not "learn" — remember. We prove it with a surprise test on day 30 and again on day 45.

## 2. The pilot we are building for
- 10 people from the founder's network, 1 topic each, 30 days.
- Two surfaces: a **web app** (teaching, ~10 min/day) and a **Chrome extension** (retrieval, one question per pop-up, ~20 sec each).
- Success = Day-30 retention on taught concepts jumps vs. Day-0, held-out (untaught) concepts stay flat, and Day-45 (no pop-ups in between) holds ≥ 80% of Day-30.

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
- Tests: Day-0 (diagnostic), Day-30 and Day-45 surprise cold tests.

### Chrome extension
- One question card, from the due queue. Never teaches new concepts.
- Answer → instant right/wrong + one-line explanation → optional confidence tap → closes.
- Respects active windows and daily cap. 3 dismissals in a row → back off for the day.
- Once a day: mood tap (1/2/3).
- Offline queue, sync when online.

## 5. Architecture (decided — do not re-litigate)
Three **independent projects**, each with its own `package.json`, `tsconfig.json`, tests and Dockerfile. No monorepo, no workspaces. A root `docker-compose.yml` starts everything together.

```
learnos/
├── docker-compose.yml    postgres, redis, backend, frontend (extension is built, not served)
├── CLAUDE.md
├── docs/                 plan.md, loop.md, sprint.md, tasks.md, api.md, ...
├── scripts/sync-shared.sh  copies backend/src/shared → frontend/src/shared + extension/src/shared
├── backend/              Express + ws (WebSocket) + Drizzle (Postgres) + BullMQ (Redis). Port 3001.
│   ├── Dockerfile
│   ├── src/db/           schema.ts (SOURCE OF TRUTH), client.ts
│   ├── src/shared/       Zod schemas + TS types (SOURCE OF TRUTH for all three projects)
│   ├── src/scheduler/    ts-fsrs wrapper: scheduleReview, newCard, predictedRecall
│   ├── src/generator/    Anthropic SDK: generateConceptMap, generateItems (strict JSON via Zod)
│   ├── src/routes/  src/workers/  src/lib/  src/scripts/
│   └── fixtures/         real-looking LLM outputs for tests
├── frontend/             React + Vite + Redux Toolkit (RTK Query for ALL API calls + state) + react-router. Port 3000.
│   ├── Dockerfile        (vite build → nginx)
│   └── src/shared/       SYNCED COPY — never edit by hand
└── extension/            WXT + React (Manifest V3).
    ├── Dockerfile        (builds the zip into ./dist)
    └── src/shared/       SYNCED COPY — never edit by hand
```
- **TypeScript everywhere. ESM. pnpm in each project (plain, no workspaces).**
- **Shared code rule:** `backend/src/shared/` is the only place shared schemas/types are written. Run `scripts/sync-shared.sh` after changing it; frontend and extension commit the synced copy. The synced folder must contain **only** Zod + types (no Node imports) so it compiles in the browser.
- **No Qdrant, no LangChain/LangGraph.** Generation is prompt → JSON → Zod → DB.
- **Postgres tables:** users, topics, concepts, concept_prereqs, items, cards (FSRS state per user×concept), review_events (every answer), tests, daily_pulse. Schema lives at `backend/src/db/schema.ts`.
- **Auth for pilot:** magic link (email). `x-user-id` header is a dev shortcut only.
- **LLM model:** `claude-sonnet-4-6` for generation. Every generated artifact is Zod-validated; failures retry once then fail the job loudly.
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
- Retention gain: Day-30 − Day-0, per concept and overall, taught vs. held-out.
- Durability: Day-45 ÷ Day-30.
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
