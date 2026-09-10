# e2e-tasks.md — the Playwright test plan

> Format matches `tasks.md`: pick the first `todo` whose `depends_on` are all
> `done`. Update `status` and `notes` when a group is finished. Add new tasks
> in the same format; never silently widen scope.
>
> **Relationship to `tasks.md`:** Sprint 6 there (`T-134`–`T-140`) created the
> harness and the first specs. This file is the detailed plan those tasks
> summarize — one entry per **feature area**, each enumerating the flows and
> edge cases it must cover, not just the happy path. `T-135`/`T-136`/`T-137`
> stay in `tasks.md` as the umbrella; `E2E-xxx` here is where the actual
> checklist lives. When a `T-13x` task is "done", it means *some* coverage
> landed — this file is what says whether it's complete.
>
> Statuses: `todo` | `in_progress` | `done`. Every spec runs with
> `video: 'on'`, `screenshot: 'on'`, `trace: 'on'` (`playwright.config.ts`) —
> nothing here needs its own recording setup.

---

## Scope and non-scope

**In scope:** every screen a learner or the founder can reach, every backend
route behind it, and the product-specific correctness rules that unit tests
can't observe because they require a real server, a real browser, and real
routing — session redirects, the held-out privacy boundary crossing the wire,
rate limits, daily caps, and the extension's popup rendering the shared design
system correctly.

**Out of scope, deliberately** (see `playwright.config.ts`'s own comment and
`sprint.md`'s Sprint 6 note): scheduler arithmetic, backoff timing, queue retry
rules, and generator prompts. All are pure functions covered by vitest
(`scheduler/*.test.ts`, `extension/src/lib/__tests__/*`, `extension/src/__tests__/flow.test.ts`).
Re-proving them through a browser buys a slower suite that fails for
uninteresting reasons.

**Ordering principle:** groups are listed roughly in the order a learner
encounters them (auth → onboarding → diagnostic → session → map → extension →
day-30 test → results), with cross-cutting groups (privacy boundary, error
states, admin) at the end. Implement in that order unless a group is blocked.

---

## E2E-001 · Authentication and session routing
- **status:** in_progress
- **depends_on:** —
- **files:** `e2e/web/signin.spec.ts`, `e2e/auth.ts` (new helper)
- **covers:** `POST /auth/magic`, `GET /auth/verify`, `POST /auth/dev-login`, `GET /auth/oauth/:provider/start`, `POST /auth/logout`, the `/` route guard.
- **flows already passing (2026-09-10):**
  - `/` signed out renders the landing page, no email field present.
  - The landing page's call to action reaches `/signin`.
  - Dev sign-in lands on `/home` with a session to do.
- **still todo:**
  - **Magic link request** — submitting a valid email shows "check your inbox" copy; the request does not reveal whether the address is registered (same response either way — assert the *response*, not the backend's internal branch, since T-013 promises this at the API and the UI must not contradict it).
  - **Magic link rate limit** (T-FIX-007) — 4 requests for the same address within 15 minutes: the 4th is refused, and the UI shows a "try again later" state rather than silently retrying or crashing.
  - **A malformed email** — client-side validation blocks submission (button stays disabled) rather than round-tripping to the server.
  - **`GET /auth/verify` with a garbage token** — lands on an error state, not a blank screen or an infinite spinner.
  - **A used-once magic link, used twice** — first use signs in, second use is refused with an actionable message.
  - **OAuth start redirects** — `GET /auth/oauth/google/start` and `.../github/start` issue a 302 (assert via `request.get(..., {maxRedirects: 0})`, not by following it into a real Google login).
  - **Signed in, `/` redirects to `/home`** — the inverse of the already-covered signed-out case; the T-071 regression this whole group exists to prevent.
  - **Signed in, `/signin` redirects away** — nobody should be able to see the sign-in form while already authenticated.
  - **An expired/cleared session hitting a protected route** — `RequireAuth` bounces to `/signin`, not `/` (per T-101's note: someone whose cookie expired mid-session has already read the pitch, so back to the form, not the pitch).
  - **Logout** — `POST /auth/logout` then a protected route redirects to `/signin`; the session cookie is actually cleared (check via a follow-up `GET /me` returning 401).
  - **Dev sign-in is production-locked** — assert the button's `import.meta.env.DEV` gate holds in a prod build check (covered by `pnpm build` output inspection, not Playwright — note only, no spec needed here).

## E2E-002 · Onboarding (5 steps)
- **status:** todo
- **depends_on:** E2E-001
- **files:** `e2e/web/onboarding.spec.ts`
- **covers:** `frontend/src/features/onboarding/*`, `POST /topics`, `GET /topics` (generation polling), `PATCH /me`.
- **flows:**
  - A brand-new signed-in user (no topic) lands on `/onboarding`, not `/home` — the inverse routing case from E2E-001.
  - All 5 steps in order: each `Step` renders, `Stepper` shows the right position, and **the Next button is disabled until that step's required field is filled** (this is the main "edge case" per step — an onboarding step that lets you skip ahead with nothing entered is a data-integrity bug, not a UX nit).
  - Step 3 (`WindowsStep`, active hours) — enforces `ActiveWindowsSchema`'s own rules from the UI: a window with `start >= end` is rejected inline; more than 3 windows cannot be added; two overlapping windows are rejected (mirrors the schema's `superRefine`, T-054 — if the UI ever stops enforcing this client-side, the *server* still catches it, so this test's job is confirming the inline error, not data safety).
  - Submitting the final step calls `POST /topics`, returns `202`, and the UI moves to a **generation wait screen** (T-066: poll backoff) rather than a spinner that never resolves.
  - **The wait screen actually resolves** — poll until `GET /topics` reports the topic's status leaving `generating` (real generation is slow/costly; this test uses a topic already seeded as `ready`, or stubs the poll response via `page.route`, documented inline either way — do not spend $0.46 and 9 minutes per CI run, T-074).
  - **A topic stuck on `generating`** (T-069 is still `todo` in tasks.md) — this spec should assert *today's* actual behavior (probably: wait screen with no timeout) rather than a fixed future behavior, and the assertion should be loose enough not to break when T-069 ships a real fix.
  - **Double-submit protection** (T-065, done) — clicking "Build" twice does not create two topics; assert via `GET /topics` count after two rapid clicks.
  - Onboarding **cannot be re-entered** once a topic exists — landing on `/onboarding` with a topic already present redirects to `/home` (mirrors the `/` guard, same failure mode as T-071 but for a different route).

## E2E-003 · The adaptive diagnostic
- **status:** todo
- **depends_on:** E2E-002
- **files:** `e2e/web/diagnostic.spec.ts`
- **covers:** `POST /diagnostic/:topicId/start`, `GET /diagnostic/:topicId/next`, `POST /diagnostic/:topicId/answer` (route name approximate — confirm exact path in `diagnostic.routes.ts` at implementation time).
- **flows:**
  - Question count is bounded — "Question N of at most `max`" never exceeds the documented ~15, and the diagnostic **can stop early** when the map resolves (assert `data.progress.asked < data.progress.max` on the terminal render for at least one seeded run, since "stops early" is only interesting if it's observed happening, not merely possible).
  - **The Check/submit button is disabled until both an answer and a confidence rating are given** — same gate as the session (E2E-004), asserted independently here because the diagnostic is a separate component tree (`DiagnosticPage`) and a regression in one does not imply a regression in the other.
  - Answering **correctly** moves to a harder question on the same concept path; answering **wrong** moves to a prerequisite — this is the adaptive engine's headline behavior (plan.md §3.1) and the one thing a purely-random item picker would fail. Assert via the `conceptId` sequence across two runs seeded with opposite answers, not by asserting exact question text (content is generated, IDs and concept relationships are not).
  - **The terminal summary** ("certain N times, right of those M") renders with real numbers, and `sureCount >= sureCorrectCount` always (a calibration invariant, cheap to assert, catches a swapped-numerator bug for free).
  - **"See your map" from the terminal screen** navigates to `/map` and the map reflects the diagnostic's result (at least one concept is now `known` rather than `untaught` — ties this group to E2E-005).
  - **Never asks "how do you learn best"** (loop.md's standing rule, plan §3.1) — a grep-based assertion over the diagnostic's rendered text across all seeded questions, cheap insurance against a future prompt regression leaking into the UI.
  - **Refreshing mid-diagnostic** — reloading `/diagnostic/:topicId` resumes at the same question rather than restarting from zero (confirms `GET .../next` is idempotent against the stored progress, not client state).

## E2E-004 · Daily session — teaching and review
- **status:** in_progress
- **depends_on:** E2E-002
- **files:** `e2e/web/session.spec.ts`
- **covers:** `GET /session`, `POST /session/complete`, `POST /reviews`.
- **flows already passing (2026-09-10):**
  - New concept opens with "Have a go first" (try-first) before any explanation; the attempt is recorded and shown back after reveal.
  - The confidence tap gates the Check button (disabled → enabled only after a rating).
  - Grading returns a verdict and reveals Next; Next advances the step.
  - **The session actually runs its due reviews** — the T-073 regression: after the new concept, a "From an earlier day" review step is confirmed to appear (not merely possible), with no teaching UI and no "read it again" affordance.
- **still todo:**
  - **`example_first` teach mode** — a concept with `teachMode: 'example_first'` skips "Have a go first" entirely and opens straight on the explanation (plan.md §3.4's A/B; the currently-passing test only exercises `try_first`). Needs a concept seeded (or found) with the other mode — check the seed data for one, or extend `seedFormats.ts`-style script if none exists.
  - **Daily budget cap** — a session never shows more than 3 new concepts (plan.md §6); assert the step sequence contains at most 3 "New concept" headers even when more are due.
  - **"Skip this one"** on a review — recorded as no-answer (not silently dropped), and the step still advances. Assert via a follow-up API check that a `review_events` row exists with `correct: null` for that item (or the closest observable proxy from the client — confirm exact skip semantics in `SessionPage.tsx` at implementation time).
  - **"I don't know"** on the try-first attempt — same contract as Skip: advances to reveal without a filled attempt, and the reveal shows "You skipped this one" (already visible in the component per the earlier read of `SessionPage.tsx`).
  - **Session completion — "Done for today" vs "Nothing due today"** — both terminal headings exist in the source (`SessionPage.tsx:104,121`); this spec should drive a session to actual completion (not stop after one card) and assert the correct one of the two appears based on whether anything was actually done.
  - **`POST /session/complete` is called exactly once per day** — reloading `/session` after completion does not re-open cards or double-count `cards.taughtAt` (T-023's timezone-correct "today" logic, observed from outside rather than unit-tested).
  - **A concept's `codeEditor` block never appears in a review, only in original teaching** — cross-reference with E2E-008 (formats): confirm via the seeded format items that a `codeEditor` item, once due again as a review, either doesn't recur (T-088's "never a review" rule in `due.repository.ts:45`) or the assertion for this belongs entirely in E2E-008 instead — resolve which file owns it before writing, to avoid the same rule asserted twice and drifting.

## E2E-005 · The map and knowledge score
- **status:** in_progress
- **depends_on:** E2E-003
- **files:** `e2e/web/session.spec.ts` (co-located with the existing map test; may split to `e2e/web/map.spec.ts` if it grows past ~4 tests)
- **covers:** `GET /topics/:id/map`.
- **flows already passing (2026-09-10):**
  - Held-out concepts: `title` is `null` on the wire (not just hidden in CSS), and the map renders the correct count of "Held back until day 30" placeholders.
  - The score is non-zero for a learner with taught concepts (T-064 regression — "0 concepts so far" that can never move).
  - "Solid ·" legend renders for at least one concept.
- **still todo:**
  - **Every `ConceptState` renders distinctly** — `known`, `taught`, `untaught`, `heldout` each have their own legend entry and icon; assert all four appear together on the seeded topic (which has all four per the seed's own log: "23 concepts, 3 held out", plus some untaught by day 1).
  - **`atRisk` styling** — a concept flagged `atRisk: true` (predicted recall dropping) renders with the "Slipping" treatment, not folded into "Solid". Requires a concept whose FSRS state actually predicts risk — check whether the seed produces one naturally or needs `POST /dev/due-now`-style manipulation.
  - **Prerequisite edges render** — the map's edge list (`from`/`to`) is reflected in the visual graph (at minimum: an edge's `to` concept is visually gated/greyed until its `from` concept reaches `known` or `taught` — confirm the actual visual contract in `MapPage.tsx` before asserting specifics).
  - **Clicking a concept** (if interactive) shows its detail without leaking a held-out title through a tooltip, modal, or URL parameter — the T-017 privacy rule checked at every interaction surface, not just initial render.
  - **`/map/:topicId` vs `/map`** — both routes exist (`router.tsx:86,94`); confirm they render the same content for a single-topic learner, and that `/map/:topicId` with someone else's topic ID 404s or 403s rather than leaking another user's map.

## E2E-006 · Extension — connect flow and popup
- **status:** in_progress
- **depends_on:** E2E-001
- **files:** `e2e/extension/popup.spec.ts`, `e2e/extension/options.spec.ts` (new, split out)
- **covers:** `POST /auth/extension-token`, `GET /me` (verify-before-store), `GET /due`, `POST /reviews`, `POST /pulse`.
- **flows already passing (2026-09-10):**
  - Options page: empty state prompts for a token; a valid pasted token verifies against `/me` and shows the connected account.
  - Popup: unconnected state offers "Connect"; a due card renders and can be answered; the answer reaches the server (gap-line or verdict text appears).
- **still todo:**
  - **A bad/garbage token is rejected and nothing is stored** — options page shows an actionable error ("that token was not accepted"), and a subsequent popup open still shows "not connected" (confirms the failed verify didn't partially write to `chrome.storage.local`).
  - **Disconnect** — the options page's disconnect button clears the token; the popup reverts to "not connected" on next open.
  - **A revoked/expired token** — connect once, invalidate server-side (e.g. via a second `/auth/logout` or token rotation if the API supports it — confirm exact mechanism), reopen the popup: it should read as disconnected, not hang or show a raw error (per `lib/api.ts`'s `NotConnectedError` vs `ApiError` distinction).
  - **The daily mood tap appears once per local day** (T-032) — first popup open of the day (post-answer) shows the mood tap; a second open the same day does not.
  - **Dismiss** — clicking dismiss on a card does not enqueue an answer with `dismissed: true`... wait, it does (`Answer.dismissed`); assert the specific behavior: card closes, and a `review_events` row exists with `dismissed: true` and `correct: null`.
  - **Snooze** — clicking snooze closes the card without recording a completed answer in the same way dismiss does; confirmed against `Card.tsx`'s `snoozed: true` payload.
  - **Three consecutive dismissals in the actual UI** — this is the one meaningful integration case `flow.test.ts` (T-037) *cannot* cover, because it mocks the popup entirely. Open the popup 3 times (via `/dev/due-now` between each), dismiss each, and assert the 4th open — even inside an active window — shows the "resting until tomorrow" copy from `Popup.tsx`. This is the single highest-value new extension test in this plan.
  - **Never shows an untaught or held-out concept** (T-033, T-089) — seed a held-out concept's item directly into the due queue via a dev-only bypass if one exists (or confirm this is already structurally impossible per `due.repository.ts` and this becomes an assertion against the API response only, not a UI drive-through — resolve which layer actually needs the test before writing it).
  - **`codeEditor` items never appear in the popup** (T-089's `popupEligible()` filter) — seed a `codeEditor`-only due queue (via `seedFormats.ts`) and confirm `/due?limit=5` called with the extension's bearer token returns zero `codeEditor` items even though the web session would see them.

## E2E-007 · Card parity across surfaces
- **status:** in_progress
- **depends_on:** E2E-004, E2E-006
- **files:** `e2e/card.ts`, `e2e/extension/popup.spec.ts`
- **covers:** `@learnos/ui`'s `QuestionCard`, rendered by both the web session and the extension popup.
- **flows already passing (2026-09-10):**
  - Font stack and `box-sizing` match between the web session's card and the extension popup's card (not a pixel diff — a 380px popup legitimately lays out differently; this checks which design system drew it).
- **still todo:**
  - **Extend the fingerprint to colour tokens** — `promptColor`, background, and the answer-surface's border colour, not just font/box-sizing, so a T-126-style "wrong box model" bug is caught even when it doesn't touch font-family.
  - **Parity across every answer kind**, not just whichever the seeded due queue happens to serve first — loop the fingerprint check across `radio` (recognition), `text` (recall/application), `number` (numeric), confirming each renders identically-themed on both surfaces. Depends on E2E-008's format seed being available to both projects.
  - **An answer given through the extension moves the web app's score** — answer a card in the extension project, then in the same test (or a follow-up run sharing state) load `/map` in the web project and confirm the relevant concept's mastery changed. This is the cross-surface truth claim the group's name promises and the current spec doesn't yet check — worth doing as an API-level assertion (`fetchMap` before/after) rather than two full browser contexts fighting over one page, to keep it fast and reliable.

## E2E-008 · Every answer format renders and grades
- **status:** todo
- **depends_on:** T-140 (seed script — **done**, live-generation check still open)
- **files:** `e2e/web/formats.spec.ts`, `e2e/extension/formats.spec.ts` (for the popup-eligible subset only)
- **covers:** every `answerKind` in `ANSWER_BLOCK_KINDS`, plus the four plain (blockless) item types.
- **flows:**
  - Each of the 5 seeded format items (`clozeCode`, `hotspotLine`, `orderLines`, `numeric`, `codeEditor` — from `backend/src/scripts/seedFormats.ts`) renders its **own dedicated answer surface**, not the generic text-box fallback. This is the exact regression class T-118 was ("`numeric` shipped half-built, a field nothing read") — a test here would have caught it on day one.
  - Each format **accepts an answer and grades it** — fill the cloze hole, click the hotspot line, drag/click the order-lines into sequence, type a number within tolerance, write passing code — and each surfaces a verdict.
  - The 4 plain types (`recall`, `recognition`, `application`, `explain`) each render their documented surface: recognition → 4 radio options; explain → textarea; recall/application → single-line input (per `QuestionCard.tsx`'s fallthrough branch).
  - **`codeEditor` is absent from the extension's popup** (T-089) — covered jointly with E2E-006's last bullet; this file supplies the seed, that file supplies the assertion, to avoid duplicating the seed setup in two places.
  - **`codeEditor` is absent from the Day-30 test** (T-093) — same cross-reference pattern against E2E-009.
  - **A `numeric` answer just outside tolerance is marked wrong; just inside is marked right** — the one edge case worth a dedicated assertion, since `tolerance` is a fraction (`0.1` = ±10%) and an off-by-one in the comparison (`<` vs `<=`, or absolute vs relative) is exactly the kind of bug that ships quietly.
  - **`orderLines`' `swapBreaks` pair** — swapping the two lines the schema records as the correct order is marked wrong (not just "any non-matching order" — the specific documented pair, since that's what the content author validated during QA).
- **notes:** (2026-09-10) `backend/src/scripts/seedFormats.ts` is written and confirmed working — 5 items seeded, all passing `ItemPayloadSchema`. **What's still open from T-140's own scope:** confirming a *live* code-topic generation actually emits blocks (today's dev database has zero organically-generated ones). That check is independent of this E2E group and shouldn't block writing these specs against the seeded fixtures.

## E2E-009 · The Day-30 cold test
- **status:** todo
- **depends_on:** E2E-005
- **files:** `e2e/web/test.spec.ts`
- **covers:** `POST /topics/:id/tests`, `GET /topics/:id/tests`, `GET /tests/:id/next`, `POST /tests/:id/answer`, `POST /tests/:id/complete`.
- **flows:**
  - Starting a test (`POST /topics/:id/tests`) when the topic is still within its teaching window vs. past `holdout` — confirm the actual gating rule in `tests.routes.ts`/`tests.service.ts` before asserting (T-039's lifecycle); this is likely dev-only-triggerable outside the real 30-day wait, so check for a `/dev/*` bypass first.
  - The test serves between 25–30 items spanning taught, held-out, and transfer concepts (plan.md's Day-30 design) — assert the *mix*, not just the count, by cross-referencing served `conceptId`s against the map's `heldout`/`taught` states.
  - **A held-out concept's title never appears anywhere in the test UI** — same privacy boundary as E2E-005, re-asserted here because the Day-30 test is the one screen where held-out concepts are *finally* shown, making it the highest-risk surface for a title to leak by accident.
  - `POST /tests/:id/answer` records confidence and latency (`TestSubmitSchema`); the UI enforces the same confidence-required gate as the session (E2E-004) — or doesn't, if the day-30 test's design differs; confirm against `TestPage.tsx` before asserting.
  - **Resuming an incomplete test** — reloading `/tests/:testId` mid-test resumes at the next unanswered item rather than restarting (mirrors E2E-003's diagnostic-resume case).
  - `POST /tests/:id/complete` computes and stores scores (`TestScoresSchema`); a completed test cannot be re-started or re-answered (confirm the actual guard — 409? redirect to results?).
  - **A single held-out concept is a coin flip** (T-123, done) — confirm the *fix* holds from the outside: the control arm's held-out set is large enough that the scoring doesn't reduce to one concept's result. This may be more appropriate as a data-shape assertion (`heldOutList.length > 1`) than a full UI flow.
  - **T-093's "no four-minute question on the Day-30 test"** — confirm no `codeEditor` block appears among served items (cross-reference E2E-008).

## E2E-010 · Results page
- **status:** todo
- **depends_on:** E2E-009
- **files:** `e2e/web/results.spec.ts`
- **covers:** `GET /topics/:id/results` (confirm exact route in `results.routes.ts` — the earlier grep showed a multi-line definition, re-read at implementation time).
- **flows:**
  - Before scores exist (`data.taught === null`) — the page shows the topic title only, no percentages, no crash (per `ResultsPage.tsx:66`'s early-return branch).
  - After scoring — the headline sentence renders real percentages ("remembered X% of what we taught... against Y% of what we deliberately didn't"), and `X`/`Y` match `fetchMap`-style values pulled independently via the API in the test, not just "some number appeared".
  - **"What stuck" / "What didn't" / unasked concepts** — all three lists (`stuck`, `slipped`, `unasked` per the component's own filter logic) render distinctly, and a concept never appears in more than one list.
  - **"Everything we taught cleared half"** — the empty-state copy for `slipped.length === 0` renders instead of an empty list with no explanation (per `ResultsPage.tsx:119`).
  - **A held-out concept never appears in "What stuck"/"What didn't"** — those lists are `taughtList`-derived (`!c.heldOut`) per the source; a regression that let a held-out concept leak into either list would be a privacy break disguised as a display bug, worth its own assertion.

## E2E-011 · Admin dashboard
- **status:** todo
- **depends_on:** E2E-001
- **files:** `e2e/web/admin.spec.ts`
- **covers:** `GET /admin/metrics`, the admin retire-item route (second route in `admin.routes.ts`, name TBD at implementation time), `requireAdmin` middleware.
- **flows:**
  - **A non-admin signed-in user hitting `/admin` or `GET /admin/metrics` directly is refused** — this is the one access-control test in the whole plan that actually matters: `requireUser` then `requireAdmin` "in that order and never merged" per the route file's own comment, meaning a 401 (not authenticated) and a 403 (authenticated, not admin) must be distinguishable. Assert both codes independently — logged-out gets 401, logged-in-non-admin gets 403.
  - The seeded dev user's admin status — confirm whether `dev@learnos.local` is an admin in the seed data; if not, this whole group needs an admin-flagged seed user first (check `seed.ts` before assuming).
  - Metrics render every number `plan.md §7` promises (retention gain, calibration gap, scheduler calibration, teach-mode comparison, extension stats) — a smoke-level assertion that each labeled figure is present and numeric, not that the numbers are *correct* (that's the metrics queries' own test coverage, presumably in `backend/src/modules/admin/*.test.ts`).
  - **Retiring an item via the admin UI** sets `flaggedBad` past the retirement threshold and the item stops being served by `/due` and `/session` (ties the admin action to the due-repository's `RETIRED_FLAG_THRESHOLD` filter — cross-surface, worth the full round trip).

## E2E-012 · Pulse (daily mood tap) and telemetry
- **status:** todo
- **depends_on:** E2E-006
- **files:** `e2e/web/pulse.spec.ts` or folded into E2E-006 if it stays this small
- **covers:** `POST /pulse`, `POST /telemetry`.
- **flows:**
  - `POST /pulse` accepts one submission per learner-local day; a second same-day submission is rejected or is a no-op (confirm exact contract — `PulseCreateSchema` and the service layer — before asserting a specific status code).
  - The extension's buffered telemetry (`card_shown`, `card_closed_no_action`) actually reaches `POST /telemetry` on the worker's alarm — this is partially an E2E concern and partially `flow.test.ts`'s job; if `flow.test.ts` already asserts the buffer contents, this group's only added value is confirming the **network call** happens, which needs `page.route`/`context.route` interception on the extension's background page. Worth doing once, low priority.

## E2E-013 · Cross-cutting: the held-out privacy boundary
- **status:** todo
- **depends_on:** E2E-005, E2E-006, E2E-009, E2E-010
- **files:** `e2e/web/privacy.spec.ts`
- **description:** Not a new feature — a **consolidated sweep** of the single rule the entire pilot's validity rests on (plan.md §6: "held-out concepts never leak a title through the map API and never appear in a session"). Each surface above asserts it locally; this group exists because the failure mode ("a title leaked *somewhere*") is exactly the kind of thing that's easy to catch per-screen and easy to miss in aggregate when a new screen is added later and nobody remembers to test it there too.
- **flows:**
  - Enumerate every response body the signed-in seeded learner's browser receives across a full walkthrough (onboarding → diagnostic → session → map → connect extension → popup → day-30 test → results) and grep all of them for the held-out concepts' known titles (fetched once via a direct DB/API check with elevated access, then treated as a denylist).
  - This is the one spec in the plan that's cheaper to write as a **single long crawl** than as scattered per-screen assertions — implement last, once every other group's flows exist to walk through.
- **notes:** This does not replace the per-feature assertions in E2E-005/006/009/010 — those catch a regression close to its cause with a fast, specific failure message. This is the safety net underneath all of them.

## E2E-014 · Cross-cutting: error and network states
- **status:** todo
- **depends_on:** E2E-001, E2E-004, E2E-006
- **files:** `e2e/web/errors.spec.ts`, `e2e/extension/offline.spec.ts`
- **description:** What the UI does when the backend says no, times out, or the network drops — as distinct from the "wrong data" edge cases already listed per-feature above.
- **flows:**
  - **A 500 from any mutating endpoint** (`POST /reviews`, `POST /session/complete`, `POST /topics`) shows an actionable error, not a silent failure or an unhandled promise rejection in the console (assert `page.on('pageerror')` stays empty across every spec in this plan, actually — consider adding this as a global fixture check rather than a one-off test, since an uncaught client exception is a real bug wherever it happens).
  - **The extension's offline queue, driven through the real UI** — this is the one thing `flow.test.ts` (T-037) explicitly cannot prove (it mocks `chrome.storage.local` and a fake `send` function): actually disconnect the extension's network (`context.setOffline(true)`), answer a card, confirm it's queued (no confusing error shown to the user — per `Card.tsx`'s "kept" messaging), reconnect, and confirm the alarm-driven drain actually reaches the real backend. High value, and currently the single biggest gap between "the unit tests are green" and "the offline story actually works."
  - **A 401 mid-session** (cookie expired while a tab was open) — the next mutating action redirects to `/signin` rather than looping or crashing.

---

## Suggested implementation order

1. **E2E-001** (auth) — everything else depends on being able to sign in reliably; the happy path exists, the edge cases (rate limit, expired session, logout) are cheap and high-value.
2. **E2E-014's offline queue test** — pulled forward ahead of its group number because it's the single highest-value gap identified in this plan (T-037 structurally cannot cover it).
3. **E2E-006's three-dismissal test** — same reasoning: the other highest-value gap, and cheap to add to an already-passing file.
4. **E2E-008** (formats) — the seed script is done; writing the specs is now unblocked and this is what actually closes T-138.
5. **E2E-002, E2E-003** (onboarding, diagnostic) — currently zero coverage; every learner passes through both.
6. **E2E-004, E2E-005, E2E-007** — extend the already-passing files with their remaining `still todo` items.
7. **E2E-009, E2E-010** (day-30 test, results) — depend on E2E-005 and touch the highest-stakes privacy surface; do these before E2E-011/012/013.
8. **E2E-011, E2E-012** (admin, pulse) — lower traffic, lower risk, but the admin access-control check is worth doing early once auth is solid.
9. **E2E-013** (privacy sweep) — last, since it walks every other flow.
10. **T-139** (CI) — after this file reads "done" or close to it, not before; a flaky E2E job in CI teaches people to ignore it (the T-111 lesson).
