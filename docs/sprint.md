# sprint.md — learnos

> Four build sprints, one week each, then the 30-day pilot. Each sprint has a demo that must work at the end. If the demo doesn't work, the sprint isn't done — don't start the next one.

**Current sprint:** Sprint 1

---

## Sprint 1 — Foundation & generation (Week 1)
**Goal:** A topic string goes in, a validated concept map with items comes out and lands in Postgres.

**Demo:** `curl -X POST /topics` with `{"title":"React Hooks"}` → job runs → `SELECT count(*) FROM concepts` shows 10–40 rows, `items` shows 6–8 per taught concept, ~10% of concepts have `held_out = true`, `teach_mode` is populated.

**Tasks:** T-001 → T-012
**Exit criteria:**
- `pnpm lint && pnpm test` green in `backend/`.
- `docker compose up --build` brings up postgres, redis, backend (`/health` OK) and frontend (serves the login page).
- Generator has fixtures and mocked tests for both prompts.
- Scheduler has unit tests for `scheduleReview`, `newCard`, `predictedRecall`.
- Test DB setup works in CI-style (fresh clone → `docker compose up postgres redis` → `cd backend && pnpm test`).

---

## Sprint 2 — Diagnostic, session, map (Week 2)
**Goal:** A user can onboard, take the adaptive diagnostic, do a daily session, and see the map + knowledge score.

**Demo:** Fresh browser → onboarding → diagnostic (~15 questions with confidence taps) → map shows green/yellow/grey → "Today's session" teaches 2 concepts (one try-first, one example-first) → map updates → score visible.

**Tasks:** T-013 → T-026
**Exit criteria:**
- Diagnostic picks items adaptively (harder after correct, prerequisite after wrong) and stops at 15 or when the map is resolved.
- Session respects `teach_mode` and daily budget.
- `cards.taughtAt` is set after a session; `review_events` rows have `predicted_recall` and `gap_days_since_last`.
- Magic-link auth works; `x-user-id` header no longer accepted in production mode.

---

## Sprint 3 — Chrome extension (Week 3)
**Goal:** Pop-up retrieval works end to end and respects the user.

**Demo:** Install extension → within an active window, a card pops with a due question → answer → feedback → confidence → card closes → `review_events` row with `surface = extension`. Dismiss 3× → no more cards today. Go offline → answer → come online → synced.

**Tasks:** T-027 → T-037
**Exit criteria:**
- Never shows an untaught or held-out concept.
- Daily cap and active windows enforced; backoff after 3 dismissals.
- Offline queue with retry; no duplicate `review_events` on resync (idempotency key).
- Daily mood tap once per day.

---

## Sprint 4 — Tests, metrics, dry run (Week 4)
**Goal:** Day-30/45 tests generate and score; the metrics dashboard answers "did it work, and why are we sure".

**Demo:** Trigger Day-30 test for a user → 25–30 items across taught + held-out + transfer → complete → `tests.scores` populated → dashboard shows retention gain (taught vs held-out), calibration gap, scheduler calibration, teach-mode comparison, extension stats.

**Tasks:** T-038 → T-048
**Exit criteria:**
- Founder completes a 5-day dry run on themselves and logs annoyances as tasks.
- Every metric in `plan.md §7` has a query and a dashboard cell.
- Day-45 test blocks the extension between Day-31 and Day-45 (`topics.status = 'holdout'`).
- Content QA checklist run on the two pilot topics.

---

## Pilot — Days 1–45
- Day −3 to 0: recruit 10, two topics × 5 people, onboard all within a 3-day window.
- Day 14: 15-min call each (questions in `plan.md` pilot section / MVP spec §6).
- Day 30: surprise test (email + web banner, no review that day).
- Day 31–45: extension silent. Day 45: second test.
- Day 46: write-up. Decision: durability ≥ 0.8 → scale; < 0.5 → fix scheduling/teaching before anything else.

---

## Backlog (not scheduled)
- Personalised FSRS parameters after ~100 reviews per user.
- Multi-topic scheduling.
- Reading-pace inference → explanation length switch.
- Question-quality loop: auto-retire items with `flagged_bad ≥ 3`.
- Mobile.
