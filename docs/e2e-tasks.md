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
- **status:** done
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
- **status:** done
- **depends_on:** E2E-001
- **files:** `e2e/web/onboarding.spec.ts`, `backend/src/scripts/seedFreshUser.ts`, `e2e/global-setup.ts`
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
- **notes:** (2026-09-10) 9 tests, all against a genuinely fresh topic-less user (`pnpm seed:fresh`, never `dev@learnos.local`, since this project's suite runs one worker sequentially and other spec files assume the dev account already has a taught topic). Found and fixed two real bugs while writing this spec, not just selector issues: **T-151** (`/onboarding` had no redirect guard for a learner with an existing usable topic and an empty local draft) and **T-152** (T-065's double-submit guard was a non-atomic check-then-insert; a real browser double-click could still create two topics — fixed with a per-user Postgres advisory lock). Also fixed a same-session-reuse bug in `seedFreshUser.ts` itself: the "submitting" tests genuinely build topics for the fresh user, so a second run needs the same topic-tree teardown `seedMatrix.ts` already learned the hard way, or the user delete hits a FK violation.

## E2E-003 · The adaptive diagnostic
- **status:** done
- **depends_on:** E2E-002
- **files:** `e2e/web/diagnostic.spec.ts`, `backend/src/scripts/seedDiagnosticUsers.ts`, `e2e/global-setup.ts`
- **covers:** `POST /diagnostic/:topicId/start`, `GET /diagnostic/:topicId/next`, `POST /diagnostic/:topicId/answer` (route name approximate — confirm exact path in `diagnostic.routes.ts` at implementation time).
- **flows:**
  - Question count is bounded — "Question N of at most `max`" never exceeds the documented ~15, and the diagnostic **can stop early** when the map resolves (assert `data.progress.asked < data.progress.max` on the terminal render for at least one seeded run, since "stops early" is only interesting if it's observed happening, not merely possible).
  - **The Check/submit button is disabled until both an answer and a confidence rating are given** — same gate as the session (E2E-004), asserted independently here because the diagnostic is a separate component tree (`DiagnosticPage`) and a regression in one does not imply a regression in the other.
  - Answering **correctly** moves to a harder question on the same concept path; answering **wrong** moves to a prerequisite — this is the adaptive engine's headline behavior (plan.md §3.1) and the one thing a purely-random item picker would fail. Assert via the `conceptId` sequence across two runs seeded with opposite answers, not by asserting exact question text (content is generated, IDs and concept relationships are not).
  - **The terminal summary** ("certain N times, right of those M") renders with real numbers, and `sureCount >= sureCorrectCount` always (a calibration invariant, cheap to assert, catches a swapped-numerator bug for free).
  - **"See your map" from the terminal screen** navigates to `/map` and the map reflects the diagnostic's result (at least one concept is now `known` rather than `untaught` — ties this group to E2E-005).
  - **Never asks "how do you learn best"** (loop.md's standing rule, plan §3.1) — a grep-based assertion over the diagnostic's rendered text across all seeded questions, cheap insurance against a future prompt regression leaking into the UI.
  - **Refreshing mid-diagnostic** — reloading `/diagnostic/:topicId` resumes at the same question rather than restarting from zero (confirms `GET .../next` is idempotent against the stored progress, not client state).
- **notes:** (2026-09-10) 6 tests, against two throwaway users (`pnpm seed:diagnostic`, `backend/src/scripts/seedDiagnosticUsers.ts`) each seeded directly with an `active` topic and a straight-line concept chain — no real generation, mirroring `diagnostic.test.ts`'s own `seedTopic()` fixture but as real rows outside the vitest harness, since a real map costs minutes and money per E2E run (T-074). Landing on `/diagnostic/:topicId` is enough to start — `useStartDiagnosticMutation` exists in `diagnosticApi.ts` but nothing in the frontend calls it; `GET .../next` computes the first question itself. The "correctly answers move deeper, wrong answers surface a prerequisite" bullet is asserted as "the two opposite-answer runs ask a different sequence of concepts" rather than the literal claim, since the actual estimate-propagation algorithm (`backend/src/lib/diagnostic.ts`) doesn't map cleanly onto "harder/prerequisite" — the backend's own unit tests already cover the exact math; this E2E test's job is confirming the UI is genuinely adaptive, not re-deriving the algorithm. "The map reflects the diagnostic's result" is left to E2E-005 as the doc itself anticipated. Two real timing bugs in the test itself (not the product) took most of the effort to find: `Choice`'s visually-hidden radio needed the same label-click fix as onboarding's spec, and — the actual bug — waiting on the `POST .../answer` network response alone raced the app's own post-response render (RTK Query cache update → re-render → the `useEffect` that resets `response`/`confidence`), intermittently filling the *next* question's input before that reset landed. Fixed by synchronizing on the visible prompt actually changing (`page.waitForFunction` polling in-page) instead of the network layer. A third, unrelated bug in the test surfaced only once the timing was fixed: the terminal heading is `That's the baseline` with a **curly** apostrophe (`'`, U+2019) — the same class of bug as T-149/onboarding's "I'm studying" — so `getByRole('heading', {name: "That's the baseline"})` with a straight apostrophe silently never matched, and a control-flow bug in the loop (reading `.question__prompt` unconditionally after every answer, even once the terminal screen had no such element) turned that into a hang rather than a fast failure.

## E2E-004 · Daily session — teaching and review
- **status:** done
- **depends_on:** E2E-002
- **files:** `e2e/web/session.spec.ts`, `backend/src/scripts/seedSessionUsers.ts`, `e2e/global-setup.ts`
- **covers:** `GET /session`, `POST /session/complete`, `POST /reviews`.
- **flows (2026-09-10):**
  - New concept opens with "Have a go first" (try-first) before any explanation; the attempt is recorded and shown back after reveal.
  - The confidence tap gates the Check button (disabled → enabled only after a rating).
  - Grading returns a verdict and reveals Next; Next advances the step.
  - **The session actually runs its due reviews** — the T-073 regression: after the new concept, a "From an earlier day" review step is confirmed to appear (not merely possible), with no teaching UI and no "read it again" affordance.
  - **`example_first` teach mode** — skips "Have a go first" entirely and opens straight on the explanation, with no attempt textarea ever appearing.
  - **Daily budget cap** — a session offers exactly 3 new concepts (`MAX_NEW_CONCEPTS`) when 5 are genuinely ready at once.
  - **"Skip this one"** on a review — the request itself carries `response: null, confidence: null` rather than the client silently moving on.
  - **"I don't know"** on the try-first attempt — reveals the explanation, and the attempt renders "You skipped this one."
  - **Session completion states** — "Nothing due today" (a topic with no ready concepts and no due reviews from the start) and "That's today done" (real work completed this run) both render on the correct condition; "Done for today" renders on reload after Finish.
- **notes:** (2026-09-10) `session.spec.ts`'s two original tests run against the shared `dev@learnos.local` account and deliberately never call `POST /session/complete` — doing so would mark *today* complete and break every later run of this same suite on the same calendar day. The new completion-state tests, and the budget-cap/`example_first` tests, needed their own disposable fixtures instead (`pnpm seed:session`, three throwaway topics: `empty` — zero concepts, zero reviews; `withWork` — one real `try_first` concept; `manyReady` — five independent concepts alternating teach mode, `endsAt` left null so `planSession` falls back to `MAX_NEW_CONCEPTS` for its pace). The real dev topic's prereq chain only ever frees up one concept at a time, which could never have exercised the 3-concept cap or guaranteed an `example_first` concept was actually due — an early version of these two tests, run against the dev topic, `test.skip`'d every single time because of exactly that. No product bugs found this pass; the `codeEditor`-never-in-a-review rule is left entirely to E2E-008, since it isn't claimed here and the underlying filter (`due.repository.ts`'s `reviewEligible()`) is identical on both surfaces — asserting it twice would just be two tests that drift.

## E2E-005 · The map and knowledge score
- **status:** done
- **depends_on:** E2E-003
- **files:** `e2e/web/map.spec.ts` (split out of `session.spec.ts`, per this task's own suggestion, once it grew past 4 tests), `backend/src/scripts/seedMapUser.ts`, `e2e/global-setup.ts`
- **covers:** `GET /topics/:id/map`.
- **flows (2026-09-10):**
  - Held-out concepts: `title` is `null` on the wire (not just hidden in CSS), and the map renders the correct count of "Held back until day 30" placeholders.
  - The score is non-zero for a learner with taught concepts (T-064 regression — "0 concepts so far" that can never move).
  - "Solid ·" legend renders for at least one concept.
  - **All five state cells at once** (`heldout`, `untaught`, `taught`, `taught`+`atRisk`, `known`) via a dedicated fixture — see notes for why the legend assertion isn't "one row per `ConceptState`".
  - **Prerequisite edges** — asserted at the API only (every edge names two concepts genuinely in the map) — see notes for why there's no UI-level assertion.
  - **A concept tile has no click affordance**, and a held-out tile's DOM carries no attribute (`title`, `href`, `data-*`) that leaks the real concept name.
  - **`/map` and `/map/:topicId` render the same content**, and another user's topic 404s.
- **notes:** (2026-09-10) Two of this task's own assumptions turned out to be wrong once the actual code was read, so the tests assert the real contract instead: **(1)** the legend has only 4 rows, not one per `ConceptState` — `known` folds into "Solid" alongside plain `taught` (`ConceptLegend` in `packages/ui/src/ConceptDot.tsx`); `known` is only distinguishable per-tile, via that concept's dot `aria-label` ("Already knew it" vs "Solid"), which is what the test checks instead. **(2)** `MapPage.tsx` never reads the API's `edges` field at all — no lines, arrows, or prerequisite gating in the UI today — so "prerequisite edges render" narrowed to an API-shape check; there is nothing on screen to assert against. Also: `pnpm seed`'s dev topic can never produce a `known` concept (`known` needs both `taughtAt` set *and* a diagnostic estimate ≥ 0.8, and `seed.ts` never writes `topics.diagnosticState`), so the state/legend/atRisk tests run against a small dedicated fixture (`pnpm seed:map`) with one concept per interesting cell instead.

## E2E-006 · Extension — connect flow and popup
- **status:** done
- **depends_on:** E2E-001
- **files:** `e2e/extension/popup.spec.ts`, `e2e/extension/backoff.spec.ts`, `e2e/extension/offline.spec.ts`, `e2e/extension/connection.spec.ts` (new), `e2e/extension/cardActions.spec.ts` (new), `backend/src/scripts/revokeExtensionToken.ts` (new)
- **covers:** `POST /auth/extension-token`, `GET /me` (verify-before-store), `GET /due`, `POST /reviews`, `POST /pulse`.
- **flows (2026-09-10):**
  - Options page: empty state prompts for a token; a valid pasted token verifies against `/me` and shows the connected account.
  - Popup: unconnected state offers "Connect"; a due card renders and can be answered; the answer reaches the server (gap-line or verdict text appears).
  - **A bad/garbage token is rejected and nothing is stored** — exact 401 error text shown, and a subsequent popup open still shows "not connected yet".
  - **Disconnect** clears the stored token; the popup reverts to "not connected" on next open.
  - **A revoked token** — see notes; the popup's real contract is "never hang or show a raw error," not "detect the revocation."
  - **The daily mood tap** appears once per local day, only after an answered card; a second answered card the same day does not ask again.
  - **Dismiss and Snooze** — exact request payloads confirmed (`dismissed: true`/`snoozed: true`, no `response` field), and a snoozed card is confirmed still due afterward.
  - **Three consecutive dismissals in the actual UI** — done previously (`backoff.spec.ts`).
  - **Held-out/untaught concepts** and **`codeEditor` items** can never reach `/due` — both asserted at the API only, since both are structurally guaranteed at the query level (see notes).
  - **A fieldset (the confidence tap) never shows the browser's raw default border** (T-153) — found by a human looking at a screenshot, not by any assertion in this file; every existing test here used text/role assertions that don't notice a stray border, so all of them kept passing through the whole regression. Now a dedicated, permanent check.
- **notes:** (2026-09-10) The task doc's own premise for "revoked token" didn't survive reading the code: there is no HTTP route that can revoke an extension bearer token at all — `POST /auth/logout` only ever reads the session *cookie*, never an `Authorization` header — so a new backend script (`revokeExtensionToken.ts`, `pnpm revoke-token <raw-token>`) does it directly via `revokeSession()`, the same function `/auth/logout` itself calls. Once revoked, the popup does **not** read as "disconnected" — its own `getToken()` check never calls `/me`, so a stored token alone reads as connected; only `fetchDue()` would see the 401, and its try/catch swallows every failure (offline, disconnected, revoked) to the same "Nothing due right now" render. That's the real, correct contract (never hang or show a raw error) — it just isn't "detect revocation," which nothing in the popup is designed to do at every open. Dismiss and Snooze also turned out to behave identically server-side (`recordReview.ts`): both `correct: null`, both never reschedule — the only difference anywhere is the `dismissed`/`snoozed` boolean columns themselves and client-side backoff bookkeeping, confirming the task doc's own self-correcting note ("wait, it does"). Held-out/untaught exclusion and the `codeEditor` popup filter are both enforced in the SQL query itself (`due.repository.ts`, `popupEligible()`), not app logic — there is no UI path that could violate either, so both are asserted as API-response checks rather than forced through a UI drive-through that could never meaningfully fail.

## E2E-007 · Card parity across surfaces
- **status:** in_progress
- **depends_on:** E2E-004, E2E-006
- **files:** `e2e/card.ts`, `e2e/extension/popup.spec.ts`
- **covers:** `@learnos/ui`'s `QuestionCard`, rendered by both the web session and the extension popup.
- **flows already passing (2026-09-10):**
  - Font stack and `box-sizing` match between the web session's card and the extension popup's card (not a pixel diff — a 380px popup legitimately lays out differently; this checks which design system drew it).
- **still todo:**
  - **Parity across every answer kind**, not just whichever the seeded due queue happens to serve first — loop the fingerprint check across `radio` (recognition), `text` (recall/application), `number` (numeric), confirming each renders identically-themed on both surfaces. Depends on E2E-008's format seed being available to both projects.
  - **An answer given through the extension moves the web app's score** — answer a card in the extension project, then in the same test (or a follow-up run sharing state) load `/map` in the web project and confirm the relevant concept's mastery changed. This is the cross-surface truth claim the group's name promises and the current spec doesn't yet check — worth doing as an API-level assertion (`fetchMap` before/after) rather than two full browser contexts fighting over one page, to keep it fast and reliable.
- **notes:** (2026-09-10) Attempted "extend the fingerprint to colour tokens" (`promptColor`, `backgroundColor`, `answerBorderColor`) and found it doesn't work as a cross-surface *equality* check: the web session's spaced-review card renders with `.teach__card--retrieval`'s deliberately inverted treatment (dark background, light text — "a different kind of moment," by the component's own design comment), which the extension's popup card was never built to have at all. A first attempt at comparing raw colour values failed immediately — not on a bug, but on two intentionally different visual states (confirmed by reading both fingerprints side by side: `rgb(250,248,245)` text on `rgb(43,39,35)` background on web, the exact reverse on the extension). `fingerprint()` still captures the three new fields for manual/diagnostic reference in the written parity JSON, but `popup.spec.ts` only asserts `promptFont`/`boxSizing` equality, as before. The actual bug this exploration surfaced (T-153, a stray fieldset border in the extension only) is caught directly in `e2e/extension/cardActions.spec.ts`, on the extension alone, where there's exactly one surface and no cross-surface variant mismatch to confuse the signal.

## E2E-008 · Every answer format renders and grades
- **status:** in_progress — renders, yes; grades, not yet
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
  - (2026-09-14) **`e2e/web/formats.spec.ts` lands, and it found three real bugs on its first run.** It walks a session and asserts every card renders *its own* surface rather than the generic text box, attaching a screenshot of each to the HTML report — so `pnpm e2e:report` is now a contact sheet of every question surface the product can show.
  - **`seedFormats` alone could not support this.** It puts all five formats on one concept, and the scheduler serves one item per due concept, so only ever one of the five could appear. `pnpm seed:formats:showcase` (`seedFormatShowcase.ts`) spreads **one card per concept** and is what makes "screenshot every format" deterministic. It imports `FORMAT_SEEDS` rather than copying payloads, and adds the six content kinds — including `code` three ways (short, three margin notes, a dimmed range) and `diagram` at both its minimum and the five-node cap, because what breaks a listing is its data, not its kind.
  - Bugs found: **ClozeCode rendered overlapping lines** (a `display: contents` wrapper with no such rule in the stylesheet — the identical bug `CodeBlock` records under T-146, which ClozeCode was never given); **`orderLines` was unreadable** (`&__line` had no colour, so it inherited the dark card's light ink onto a `--surface` row); and **a five-node `diagram` was clipped** (one row is ~1060px, needing a zoom below ReactFlow's default `minZoom`). All three are fixed.
  - **Still open, and it is the "and grades" half of this task's title:** filling a cloze hole, clicking the hotspot, ordering the lines and the numeric tolerance edges. `answerCard()` in `e2e/card.ts` now knows how to *drive* each block surface, so the grading assertions have something to build on.
  - `codeEditor` is seeded but asserted **absent** from a session: `reviewEligible()` excludes it because a `codeEditor` is never a review (T-088). Seeing it rendered needs a surface that is not the due queue.

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
- **status:** in_progress (offline queue sub-case done)
- **depends_on:** E2E-001, E2E-004, E2E-006
- **files:** `e2e/web/errors.spec.ts`, `e2e/extension/offline.spec.ts`
- **description:** What the UI does when the backend says no, times out, or the network drops — as distinct from the "wrong data" edge cases already listed per-feature above.
- **flows:**
  - **A 500 from any mutating endpoint** (`POST /reviews`, `POST /session/complete`, `POST /topics`) shows an actionable error, not a silent failure or an unhandled promise rejection in the console (assert `page.on('pageerror')` stays empty across every spec in this plan, actually — consider adding this as a global fixture check rather than a one-off test, since an uncaught client exception is a real bug wherever it happens).
  - **The extension's offline queue, driven through the real UI** — this is the one thing `flow.test.ts` (T-037) explicitly cannot prove (it mocks `chrome.storage.local` and a fake `send` function): actually disconnect the extension's network (`context.setOffline(true)`), answer a card, confirm it's queued (no confusing error shown to the user — per `Card.tsx`'s "kept" messaging), reconnect, and confirm the alarm-driven drain actually reaches the real backend. High value, and currently the single biggest gap between "the unit tests are green" and "the offline story actually works."
  - **A 401 mid-session** (cookie expired while a tab was open) — the next mutating action redirects to `/signin` rather than looping or crashing.

## E2E-015 · A configuration matrix, and a UI/UX walkthrough audit
- **status:** done
- **depends_on:** E2E-001, E2E-004, E2E-005
- **files:** `backend/src/scripts/seedMatrix.ts`, `e2e/audit/walkthrough.spec.ts`, `docs/ux-audit.md` (findings)
- **description:** Raised directly by the founder (2026-09-10): rather than one seeded learner in one state, build several users spanning the states the product actually has, walk each through login → their topic → whatever screens apply, capture what's shown, and write down whether it's clear and helpful — not pass/fail, a qualitative read.
- **a real constraint found while planning this:** `DashboardPage.tsx` and `AppBar.tsx` both read `topics.topics[0]` with no way to switch — a user's second and third topic exist in the database but are **not reachable through any in-app navigation**, only by knowing `/map/:topicId` or `/results/:topicId` directly. This isn't a bug (plan.md already scopes the pilot to "not per-learner topics", T-058 tracks opening it up); it does mean a matrix built as "N topics per user, explored via the UI" mostly can't be exercised as designed. **Scoped instead to one full configuration per user** — closer to how the pilot itself runs one topic per learner — with a couple of users given a deliberately-unreachable second topic specifically to demonstrate and document the limitation, rather than to route through it.
- **the matrix (8 users, ~13 topics total):** one topic fixture's content (`backend/fixtures/*`, the same one `pnpm seed` uses) reused across every topic — this audit is about **states and configurations**, not about generated content quality, which T-024/T-045's QA checklist already owns. Each user gets a distinct `topics.status` / progress combination:
  1. **generating** — fresh onboarding, still on the wait screen.
  2. **active, diagnostic not started** — signed up, about to take the diagnostic.
  3. **active, diagnostic done, nothing taught yet** — about to start day 1.
  4. **active, mid-course** — some taught, some due, some untaught (today's default `pnpm seed` shape).
  5. **active, fully taught, nothing due** — caught up, the "nothing due today" empty state.
  6. **holdout** — day 8–29, the quiet period; the app should say nothing is coming.
  7. **testing** — the day-30 test is available to start.
  8. **done** — test completed, `ResultsPage` has real percentages.
  - Plus: one **failed** generation (the `error` column populated) folded into the matrix as a 9th state if a spare user slot allows it — worth seeing on purpose, since nothing in the current suite exercises it.
  - Two of the above (#4 and #5) additionally get a second, UI-unreachable topic: one heavy with format-block items (cloze/hotspot/order/numeric/codeEditor) to audit the richer question surfaces outside the plain fixture, one in `done` status to confirm `/results/:topicId` renders correctly for a topic that never appears in that user's own nav.
- **what the audit spec does:** signs in as each matrix user, follows whatever route their state actually permits (dashboard → session, or → diagnostic, or → the day-30 test, or nothing at all for `holdout`), captures a full-page screenshot and the page's visible text at each stop, and does **not** assert pass/fail beyond "the page rendered without a client-side error" — the judgment happens afterward, by reading the screenshots.
- **the deliverable is `docs/ux-audit.md`**, not a green test run: a short written pass per state — what's on screen, whether it says the right thing, and anything confusing enough to be worth its own task. Any real finding gets filed as a `T-xxx` in `tasks.md`, the same convention as T-141.
- **tests:** none in the pass/fail sense; the spec's job is capture, not assertion. (A cheap `page.on('pageerror')` check across every stop is worth keeping, since an uncaught exception is unambiguously a bug regardless of how subjective the rest of the audit is.)
- **notes:** (2026-09-10) 9 users, 11 topics, zero uncaught client errors across every state. Found and fixed three real bugs in the seed script itself before the audit was trustworthy — worth recording, since each would have silently produced a wrong or misleading finding otherwise:
  - `wipeMatrix()` initially deleted only `topics`/`concepts`/`items`/`cards`/`reviewEvents` before deleting a `users` row, and Postgres refused with a foreign-key violation on `sessions` — five more tables reference `users.id` (`sessions`, `authTokens`, `oauthAccounts`, `dailyPulse`, `clientEvents`) and none of them hang off a topic, so the topic-scoped cleanup loop never reached them.
  - `endsAt` was set to `now + 7 days` for **every** topic regardless of status, so `testIsDue()` (`testLifecycle.ts`) always saw a future `endsAt` and refused every `POST /topics/:id/tests` with `409 test_not_due` — the `testing`/`holdout`/`done` configs needed `startsAt` genuinely in the past, not just a status column set to the right enum value.
  - `GET /topics` orders **newest-first** (`orderBy(desc(topics.createdAt))`), so the "primary, dashboard-visible" topic has to be created *after* the "extra, URL-only" one — the reverse of the obvious order — or the two swap roles silently. Caught by the audit itself: `matrix-04`'s dashboard showed the wrong topic's data until this was fixed.
  - Four real product findings survived into `docs/tasks.md` (T-142, T-143, T-144) plus T-141 from E2E-001; the full write-up with screenshots is `docs/ux-audit.md`.

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
