# sprint.md — learnos

> Four build sprints, one week each, then the 30-day pilot. Each sprint has a demo that must work at the end. If the demo doesn't work, the sprint isn't done — don't start the next one.

**Current sprint:** Sprint 3 (re-sequenced — see below)

---

## Build order (2026-09-05 — supersedes the sprint numbering below)

The sprint numbers stay as they are, because every task carries one and they are
how the history reads. The **order of work** changed:

```
1.  T-073          the session must actually ask its due reviews
2.  T-038 → T-040  generate a Day-30/45 test, score it, compute retention
3.  T-041          the dashboard that shows the answer
4.  T-028 → T-037  the Chrome extension (rest of Sprint 3)
5.  T-045, T-044   pilot content QA, then the founder's dry run
```

**Why.** Sprints 1–3 built the teaching machine: onboarding, diagnostic,
teaching, scheduling, map, and the extension scaffold. None of the measurement
exists — there is no way to generate a Day-30 test, score one, or compute a
retention gain. The whole thesis is "learning doesn't count until it survives
forgetting", and today the code cannot say whether it survived. A pilot run in
this state produces ten learners and no answer.

T-073 comes first because it is smaller than it looks and everything downstream
depends on it: `GET /session` returns due reviews and the screen counts them
without ever asking, so **no retrieval happens between sessions at all**.
Retrieval practice is the mechanism (plan.md §3.2); until the extension ships,
the web session is the only place it can happen. Measuring retention before
fixing this would measure a product that isn't running its own method.

**The cost of this order:** the extension slips, so the pilot's between-session
retrieval is web-only — a learner has to open the app rather than being met
where they already are. That weakens the effect the pilot is trying to detect,
and it is the reason the extension stays next in line rather than last.

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

**Tasks:** T-054 (schema, first) → T-013 → T-014 → T-053 → T-015 → T-023 → T-016 → T-017 → T-018 → T-019 → T-020 → T-021 → T-022 → T-024 → T-025 → T-FIX-005 → T-026

**Exit criteria:**
- Diagnostic picks items adaptively (harder after correct, prerequisite after wrong) and stops at 15 or when the map is resolved.
- Session respects `teach_mode` and daily budget — and the two arms genuinely differ in what the learner sees, or plan.md §3.4's expertise-reversal comparison measures nothing.
- Teaching content (try-first prompts, short/long explanations, corrections) is generated and persisted — T-053. Without it `GET /session` cannot satisfy the `NewConceptSchema` contract T-003 already committed.
- `cards.taughtAt` is set after a session; `review_events` rows have `predicted_recall` and `gap_days_since_last`.
- Magic-link auth works; `x-user-id` header no longer accepted in production mode.
- Held-out concepts never leak a title through the map API and never appear in a session — the control group is what the pilot's result rests on.
- `application` items are graded so that a correct answer in the learner's own words counts (T-FIX-005), otherwise Day-30 retention is measured through a broken instrument.

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
- The extension goes silent for the twenty-three days between the last session and the Day-30 test (`topics.status = 'holdout'`).
- Content QA checklist run on the two pilot topics.

---

## Pilot — Days 1–30
> Rewritten 2026-09-07 to follow plan.md's 2026-09-06 decision: **seven days of teaching, then
> silence, then one cold test on day 30.** The day-45 test is dropped — with twenty-three days of
> silence the day-30 test is already cold, so a second one measured nothing the first did not.
- Day −3 to 0: recruit 10, two topics × 5 people, onboard all within a 3-day window.
- Days 1–7: daily sessions (~10 min) plus extension cards inside the learner's own windows.
- Days 8–29: silence. No cards, no reminders, no email. This gap *is* the measurement.
- Day 14: 15-min call each (questions in `plan.md` pilot section / MVP spec §6). A call is not a review — it must not touch the material.
- Day 30: surprise test (email + web banner, no review that day).
- Day 31: write-up. Decision: retention gain over the held-out arm is the number; a taught delta on its own is not evidence.

---

## Backlog (not scheduled)
- Personalised FSRS parameters after ~100 reviews per user.
- Multi-topic scheduling.
- Reading-pace inference → explanation length switch.
- Question-quality loop: auto-retire items with `flagged_bad ≥ 3`.
- Mobile.
