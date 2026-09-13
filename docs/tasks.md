# tasks.md — learnos

> Format for every task is fixed. Pick the first `todo` whose dependencies are `done`. Update `status` and `notes` when you finish. Add new tasks in the same format; never do unlisted work silently.
>
> Statuses: `todo` | `in_progress` | `blocked` | `done`

---

## Where things stand — 2026-09-05

**65 of 113 tasks done** (1 in progress, 1 blocked, 46 todo). Sprints 1 and most of 2 are shipped: backend **407 tests**, frontend **49**, extension **31**, all lint-clean.

> The count above used to read "55 of 94" and had drifted — it is now taken from the file itself (`awk '/^### T-/{t=$2} /^- \*\*status:\*\*/{print $3}' docs/tasks.md | sort | uniq -c`), so it is worth re-deriving rather than hand-incrementing.

**Working end to end today:** magic-link + Google/GitHub sign-in · five-step onboarding · real topic generation (verified: 40 concepts / ~256 items per topic against the live API) · adaptive diagnostic · session planner with the try-first vs example-first A/B · map and knowledge score · dashboard.

**Re-sequenced to measurement-first (2026-09-05).** Sprint numbers still label each task; the order of work is in `sprint.md`'s **Build order** block and runs:

`T-073` → `T-038` → `T-039` → `T-040` → `T-041` → the rest of the extension (`T-028`…) → `T-045`, `T-044`.

**Sprint 3 closed 2026-09-10** with T-036 (the build and install doc) and T-037 (the simulated-day integration test). Everything in the build order above is now done except the last pair: **`T-045` pilot content QA on the three pinned topics, then `T-044` the founder's dry run.** Those two are what stand between here and Day −3.

The teaching machine is built and the measuring instrument is not: nothing can generate a Day-30 test, score one, or compute a retention gain, so a pilot run today would produce ten learners and no answer.

### Sprint 5 — question formats (added 2026-09-05, designed, partly built)

Every item today is a prompt string and a textarea, whatever the subject. Two of the three pilot topics are code topics and one is systems, so the format the pilot measures retention *through* is the one least suited to them. Designed in full on two canvases; the links and the reasoning are in the Sprint 5 section below.

**Done:** `T-079` (schema) · `T-090` (`shared-ui/`) · `T-091` (`topics.language`) · `T-080` (the block union, the two-schema split, the projection that keeps answer keys off the wire) · `T-082` (the map decides each concept's domain) · `T-083` (`domains/code.md` and the provider contract for blocks). **The generator side of the code category is complete** — what is missing is everything that puts a block on a screen: `T-084` highlighting, `T-085` the renderer, `T-086`–`T-088` the answer surfaces.
**Blocked on a founder call:** `T-081` — CodeMirror is a UI library and `loop.md §2` bars one. It blocks `T-088` only.
**Next:** `T-084` (highlight in the worker) — `T-085` renders listings unhighlighted and the palette is already waiting for it. Then `T-086`/`T-087` (the two cheap answer surfaces); `T-088` stays blocked on `T-081`. Also open and now designed: `T-101`, the landing page. `T-092` needs `T-082` as well as `T-095`, so it is not next. Nothing in Sprint 5 jumps the measurement-first order above without a deliberate decision.

**The free-text topic flow, designed 2026-09-05 (Neeraj) — `T-095` → `T-098`.** The question that started it: `T-091`'s language list is hardcoded, and language is only one example of what a topic needs to know. The answer that came out of it is a split by **who can answer**: what only the learner can say is a fast, cheap call on the topic string *before* the topic exists (`T-096`, the probe), and what only the model can say runs in the worker where nobody is waiting (`T-092`, the profile). The probe's more valuable half is not the metadata but the **viability verdict** — today any 2–120 character string enqueues ~73 model calls and five to ten minutes before anyone discovers it was `asdf` or "everything about physics". **Free text stays post-pilot** (`T-058`), gated on `T-098`'s critic, because hand-review does not scale to bespoke topics and unreviewed questions make the retention number meaningless. The pilot's three are pinned (`T-097`) and never touch any of it.

**Things this sprint learned that are expensive to rediscover:**
- **Two schemas, not one.** `ItemGenerationSchema` is what the model may return; `ItemPayloadSchema` is what we store. No model-writable field accepts markup, which closes an XSS class by construction, and the model quotes line *text* rather than line numbers — it miscounts them constantly, and the worker resolves the index. **Built in `T-080`**, which also found that every generation block wants to be `.strict()` (any unlisted field refused, not just the three that were named) and that a `reveal` block *is* the answer, so blocks need an explicit `slot` and the public projection drops reveals outright.
- **`loadTemplate()` composes a fragment as of `T-083`:** `loadTemplate(name, fragment)` reads `<name>/domains/<fragment>.md` and `runPrompt` appends it after the generic example. A fragment that does not exist is a no-op on purpose, so `math.md` and `systems.md` can be written without touching any code.
- **Strict mode sends `null`, not nothing, for an absent optional** — and `.optional()` rejects null. Use `optionalOrNull` for any field the model may omit. Found twice in `T-083`, the second time on `blocks` itself, where it would have failed every item of every topic.
- **Classify a concept by the shape of a correct answer, not the subject** — otherwise every concept in a topic called *Dynamic programming* comes back `code`. **Built in `T-082`**, where the load-bearing trick turned out to be the *example*: a biology topic using three domains and no `code` at all breaks the subject association far harder than any rule sentence does.
- **`pnpm lint` never compiles SCSS.** It is `tsc --noEmit` in both clients, so a broken `@use` path passes lint and fails at build. `verify.sh` and `loop.md §4` now require `pnpm build` when a stylesheet is touched.
- **`CLAUDE.md`, `plan.md`, `loop.md` and `sprint.md` were write-protected and are now writable** (founder ran `chmod u+w` on 2026-09-05). They are still the governing documents — change them deliberately, not in passing.

### Run it

```
docker compose up -d postgres redis
cd backend && pnpm preflight      # checks the LIVE environment — run this first
cd backend && pnpm seed           # a usable dataset in one command, no API key needed
cd backend && pnpm dev            # :3001
cd frontend && pnpm dev           # :5173
```

`pnpm preflight` exists because a green test suite repeatedly coexisted with an app that would not start — the suite mocks the model SDK, never reads `.env`, and only touches `learnos_test`. It checks both databases against `schema.ts` column by column, Redis, SMTP, and a real model round trip. **Run it before believing anything works.**

### Things that will bite you if nobody tells you

- **Tests cannot reach the network.** `vitest.setup.ts` replaces `fetch` and sets a sentinel API key. An unmocked generator fails with a message naming the boundary to mock, not a confusing 401 (T-FIX-009).
- **`drizzle-kit push` saying "Changes applied" is not proof the schema is live.** A container restarting onto a fresh volume takes the migrations with it; the symptom surfaces later as an unrelated 500. `pnpm preflight` catches it.
- **Never edit `schema.ts` outside a schema task** (loop.md). T-049 and T-054 are the precedent: one consolidated schema task per sprint.
- **Shared code is two packages, not copies** (since 2026-09-06). Change `packages/shared` (`@learnos/shared`) or `packages/ui` (`@learnos/ui`) and every app sees it. `@learnos/shared` is built — run root `pnpm lint`/`pnpm test`, which build it first, rather than one app's script against a stale `dist`.
- **Provider is OpenAI** with per-task model tiering in `src/llm/models.ts` — sol for the concept map, terra for teaching prose, luna for items and grading. `reasoning_effort` must always be sent explicitly: gpt-5.6 defaults to `medium` when omitted, which silently buys reasoning cost on every call. plan.md §5 is current; T-052 records why.
- **Frontend conventions:** zero inline styles — SCSS classes under `src/styles/`, components take `className`. Each feature owns its RTK Query endpoints (`features/<name>/<name>Api.ts`) and injects them; `store/api.ts` stays endpoint-free. Redux holds only client state no server owns (theme, onboarding draft) — server state is RTK Query's.
- **A topic costs ~$0.46 and ~9 minutes** — measured, not estimated: 73 model calls, 91k in / 48k out tokens for a 40-concept topic (T-074). `LLM_LOG_CALLS=1` prints every call.
- **Sign in during development** with the button on the login page — `dev@learnos.local` / `learnos` (T-070). The route does not exist under `NODE_ENV=production`.
- **Pilot runs three topics:** Sliding window, Dynamic programming, Consistency in distributed systems. Not per-learner topics — see T-058 for why, and for when that changes.

### Design

Canvas (8 artboards — design system, landing, sign-in, onboarding, diagnostic, session, map, extension card): https://claude.ai/code/artifact/dd5bf689-0bdf-4ece-ac46-7d683699ccbe
Source in `design/*.dc.html`. Tokens are mirrored in `frontend/src/styles/_themes.scss`.

---

## Sprint 1 — Foundation & generation

## Sprint 2 — Diagnostic, session, map

> **Build order.** `T-054` (schema) first — everything else in this sprint reads or writes
> columns it adds. Then the backend spine `T-013 → T-014 → T-053 → T-015 → T-023 → T-016 → T-017`,
> then the web tier `T-018 → T-019 → T-020 → T-021 → T-022`, then tooling `T-024`/`T-025`,
> and `T-026` closes the sprint. `T-FIX-005` (application grading) should land before
> `T-026` so the integration test measures real grading.
>
> **Sprint 2 exit demo** (sprint.md): fresh browser → onboarding → diagnostic (~15 questions
> with confidence taps) → map shows green/yellow/grey → "Today's session" teaches 2 concepts
> (one try-first, one example-first) → map updates → score visible.

### T-053 (pointer) · Teaching content generator — try-first prompts, explanations, corrections
> Moved into the Sprint 2 build order (originally logged under "Fix / discovered tasks").
> Full entry is below in that section — it is the missing input to T-016 and T-021, and
> must land before either. `depends_on` updated to include T-054.

## Sprint 3 — Chrome extension

## Sprint 4 — Tests, metrics, dry run

### T-043 · Email transport (real)
- **status:** in_progress
- **sprint:** 4
- **depends_on:** T-013, T-039
- **files:** `backend/src/lib/mail.ts`, `backend/src/lib/env.ts`, `backend/src/index.ts`, `backend/.env.example`
- **description:** Resend (or SMTP) transport behind the existing interface. Templates: magic link, test-ready, day-14 check-in.
- **tests:** Transport selected by env; templates render without missing variables.
- **notes:** (2026-09-05) **Transport pulled forward out of Sprint 4** — Neeraj supplied Mailgun SMTP credentials, so magic links can send for real during Sprint 2 testing rather than waiting for Sprint 4. Only the magic-link path is done; the **test-ready and day-14 check-in templates remain open** because they depend on T-039's lifecycle, which doesn't exist yet. Status stays `in_progress`, not `done`.
  - Added `nodemailer` (one new dependency). Reason: Mailgun's HTTP API needs an API key, which is a different credential from the SMTP password we have, so SMTP is the path this account actually supports.
  - **Real mail is opt-in twice over**: `configureMailTransport()` selects SMTP only when `SMTP_HOST` is set *and* `NODE_ENV !== 'test'`. A suite that forgets to stub the transport therefore cannot mail a learner — the same fail-closed reasoning as `toPublicItem`. Called once from `index.ts`, never at import time.
  - The SMTP client is built lazily on first send, so importing `lib/mail.ts` never opens a connection (same reason `workers/queue.ts` constructs its BullMQ queue lazily).
  - Verified by running nodemailer's `verify()` against Mailgun — it completes the SMTP handshake and authenticates **without sending anything**, so the credentials are confirmed with no test email delivered. A live send has not been attempted.
  - Env added: `SMTP_HOST`, `SMTP_PORT` (465), `SMTP_SECURE` (true), `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`. `.env.example` carries empty placeholders; real values live only in `backend/.env`, which is gitignored and untracked (verified before committing).
  - **⚠ The Mailgun SMTP password was pasted into a chat transcript and should be rotated.** It authenticates as `profract-admin@mail.profract.com` and can send mail as that domain. Rotating it is a Mailgun dashboard action plus one line in `backend/.env` — no code change.

### T-044 · Dry-run checklist + annoyance log
- **status:** todo
- **sprint:** 4
- **depends_on:** T-037, T-041
- **files:** `docs/dryrun.md`
- **description:** Founder runs 5 days on a real topic. Log every friction point as a `T-FIX-xxx` task with a severity. Fix all `high` before pilot.
- **tests:** none.

### T-045 · Pilot content generation + QA for two topics
- **status:** todo
- **sprint:** 4
- **depends_on:** T-024, T-044
- **files:** `qa/<topic>.md` ×2
- **description:** Generate both pilot topics, run QA export, review, apply edits. Record time taken and error rate found (this is a metric too).
- **tests:** none.

### T-046 · Privacy & data handling
- **status:** todo
- **sprint:** 4
- **depends_on:** T-013
- **files:** `docs/privacy.md`, `backend/src/routes/users.ts`
- **description:** Plain-language note shown at onboarding: what we log, why, that it's a pilot. `DELETE /me` wipes the user (cascade). Export `GET /me/export` (JSON of all their data).
- **tests:** Delete cascades to all tables; export contains review_events count.

### T-047 · Error monitoring + health
- **status:** todo
- **sprint:** 4
- **depends_on:** T-001
- **files:** `backend/src/index.ts`, `backend/src/lib/log.ts`, `frontend/src/app/ErrorBoundary.tsx`
- **description:** Structured JSON logging with request id; `/health` checks Postgres and Redis; worker failures logged with job data; optional Sentry DSN.
  - **The web app has no error boundary anywhere.** Found while testing T-071: a `GET /session` response missing `newConcepts` makes `DashboardPage` throw on `.length`, React unmounts the whole tree, and the learner gets a blank white page with the error only in the console. That is the worst possible failure for a pilot participant — nothing to report but "it stopped working" — and every screen has the same exposure. One boundary around the routed area, showing what broke and a way back, plus (once a DSN exists) reporting it.
  - `/health` currently returns `{ok:true}` without touching Postgres or Redis, so it answered 200 the whole time the database was down during this session's walkthrough.
- **tests:**
  - `/health` returns 503 if Redis is down (mock), and 503 if Postgres is unreachable.
  - A screen that throws renders the boundary, not a blank page, and the rest of the shell survives.

### T-048 · Deployment
- **status:** todo
- **sprint:** 4
- **depends_on:** T-047
- **files:** `backend/Dockerfile` (already exists — harden), `fly.toml` or `render.yaml`, `docs/deploy.md`
- **description:** Backend container runs api+worker; managed Postgres + Redis; web on static hosting; extension zip. Env vars documented. One-command deploy.
- **tests:** Container builds; `/health` OK in the deployed environment (manual).

---

## Fix / discovered tasks
_(add here in the same format as `T-FIX-001`, with sprint and severity)_

### T-059 · Leech handling — a concept you keep failing eats the whole session
- **status:** todo
- **sprint:** 4
- **severity:** high — a handful of leeches can consume most of a 10-minute daily budget
- **depends_on:** T-016
- **files:** `backend/src/lib/recordReview.ts`, `backend/src/modules/due/due.repository.ts`, `backend/src/db/schema.ts` (schema task), tests
- **description:** From the Anki comparison (2026-09-05). Anki tags a card a **leech** after a threshold of lapses (default 8) and suspends or surfaces it, because a card you keep forgetting is usually a *content* problem — ambiguous wording, two ideas in one card — not a memory problem, and left alone it returns forever at short intervals.
  learnos has no equivalent. `cards.lapses` is recorded and never read. A concept the learner keeps failing keeps coming back with a short interval, and because T-016 fills the session with due reviews before anything else, three or four leeches can crowd out the new teaching for the rest of the thirty days — silently converting the course into a loop over the learner's four worst concepts.
  Add a lapse threshold. On crossing it: stop scheduling the concept normally, flag it for the founder's QA queue (a leech is strong evidence the *item* is bad, which is exactly what T-024 is looking for), and tell the learner plainly rather than dropping it silently.
- **why it matters more here than in Anki:** an Anki user with 2,000 cards absorbs a few leeches. A learner with ~40 concepts and a 10-minute budget does not — and every session a leech steals is a session not spent on the taught-vs-held-out comparison the pilot exists to measure.
- **acceptance:** A concept lapsed N times stops dominating the due queue, appears in the QA export, and the learner is told it has been set aside rather than finding it silently gone.
- **tests:**
  - A card at the lapse threshold is excluded from `GET /due`.
  - A card one lapse below the threshold is still returned.
  - Crossing the threshold flags the concept's items for QA.
  - A leeched concept still appears on the map, marked, rather than vanishing.
  - Day-30/45 tests still include it (T-038) — setting it aside affects *practice*, never *measurement*.

### T-060 · Decide desired retention deliberately, rather than inheriting 0.9
- **status:** todo
- **sprint:** 4
- **depends_on:** T-040
- **files:** `backend/src/scheduler/index.ts`, `docs/plan.md`
- **description:** From the Anki comparison (2026-09-05). FSRS's `request_retention` (0.9 in ts-fsrs, the same default Anki ships) is the dial between study time and recall: higher retention means shorter intervals, more reviews per day, better recall. learnos inherits the default without a decision.
- **the mismatch worth thinking about:** FSRS optimises for recall **at the moment a card is due**. The pilot measures recall **on day 30 and again on day 45**, the second after a fortnight of no practice at all. Those are different objectives. A schedule tuned for 90% recall-at-review is not necessarily the one that maximises recall at a fixed future date — and durability (day-45 ÷ day-30) is the number that decides whether the product scales.
- **do not guess at it.** T-040's `schedulerCalibration` bins predicted recall against actual accuracy; that is the evidence for whether 0.9 is holding in practice. Decide after the first cohort, not before, and record the reasoning in plan.md either way. Raising it also raises daily review load, which collides with the 10-minute budget in T-016 — so this is a product decision, not just a parameter.
- **acceptance:** `request_retention` is set explicitly with a written reason, whatever value is chosen.
- **tests:** `schedulerCalibration` bins are within a stated tolerance of the target on real pilot data.

### T-061 · Review clumping: concepts taught together stay together
- **status:** todo
- **sprint:** 4
- **severity:** low for the pilot — noted because the cause is not the obvious one
- **depends_on:** T-016
- **files:** `backend/src/scheduler/index.ts`
- **description:** From the Anki comparison (2026-09-05). FSRS is deterministic: same state plus same rating gives the same interval, so the two or three concepts taught in one session come due on the same day, and keep doing so. Anki breaks that tie with interval **fuzz**.
- **verified, and not what it looks like:** `createEngine` sets `enable_fuzz: false`, which reads like the bug. It is not the fix either — measured against ts-fsrs 4.7.1, `enable_fuzz: true` produces **zero** spread across eight identical cards, even at 328-day intervals (it shifts the interval systematically, 328 → 338, but does not randomise). So turning the flag on would change nothing. Spreading load would mean doing it ourselves, or upgrading ts-fsrs and re-measuring.
- **why it is low severity here:** the pilot teaches 2–3 concepts a day for thirty days, so each day's cohort starts on a different day and the load spreads naturally. This bites when a large batch is added at once, which the session planner's cap prevents by design.
- **acceptance:** Either a measured decision to leave it, or a jitter applied at insert rather than inside the scheduler.
- **tests:** Concepts taught in one session do not all fall due on the same date; and if left as-is, a test documenting that the clumping is bounded by the 3-concept cap.

### T-058 · Generated and recommended topics (post-pilot)
- **status:** todo
- **sprint:** 5
- **depends_on:** T-044, T-045, T-096, T-098
- **files:** `backend/src/llm/prompts/topicSuggest/`, `backend/src/modules/topics/`, `frontend/src/features/onboarding/topics.ts`
- **description:** Founder vision (Neeraj, 2026-09-05): onboarding captures a profile — what the learner does, why they are here — and then **generates or recommends** topics suited to them, rather than offering a fixed pair. "DSA for developers, colour theory for designers, algebra for students."
- **why this is Sprint 5 and not now — the pilot cannot absorb it:**
  - **n = 1.** sprint.md's design is two topics × five people. Per-learner topics means every result is a single subject, and "this learner retained 81%" is explainable by motivation or by an easy topic. The day-46 branch (`durability ≥ 0.8 → scale`, `< 0.5 → fix teaching`) needs a number attributable to the *teaching*, which requires several people on the same material.
  - **Content QA does not scale to it.** T-024 measures ~1 hour of hand-review per topic and T-045 has the founder reading every question. Ten bespoke topics is ten hours on content nobody has checked — and unchecked questions make the retention number meaningless anyway.
- **not RAG, and not Qdrant.** plan.md §5 rules both out, and there is no Qdrant in the repo — the only mention is that line. RAG answers "find the relevant existing text"; learnos has no corpus, it *generates* a concept map and writes the questions. Suggesting a topic from a profile is one prompt returning a short list. If a corpus ever exists (a library of QA'd topics worth searching), revisit then — that is a different product, not a missing dependency.
- **what already exists to build on:** `features/onboarding/topics.ts` holds the pilot pair behind `recommendTopic(role)`, deliberately a lookup. Swapping that for a model call is the whole change on the client; the onboarding UI does not move.
- **the two gates, added 2026-09-05 (Neeraj):** the free-text flow was designed out in full and split into `T-095` → `T-096` (the probe: what to ask the learner, and whether the topic is even viable before it costs ~73 calls) and `T-098` (the automated critic, without which hand-review does not scale to bespoke topics). `T-097` pins the pilot three so the pilot never depends on any of it. **Confirmed post-pilot**: free text does not ship for the cohort, because the day-46 branch needs several people on the same material to separate "the teaching failed" from "that topic generated badly". What survives free text is the headline number itself — taught-versus-held-out is within-subject, so the delta still pools across learners on different topics; what is lost is the ability to explain it.
- **acceptance:** A learner's profile yields 3–5 candidate topics with a stated reason each; choosing one generates and QA-gates it before teaching starts.
- **tests:**
  - Suggestions for a stated role are on-topic and distinct from each other.
  - A generated topic passes the same `MIN_CONCEPTS` and DAG validation as a hand-picked one.
  - A topic that fails validation is never offered to a learner.
  - Profile answers never reach the teaching path — only topic selection (plan.md §3.1).

### T-057 · Vertex AI provider via Application Default Credentials
- **status:** todo
- **sprint:** 4
- **depends_on:** T-056
- **files:** `backend/src/llm/client.ts`, `backend/src/lib/env.ts`, `docs/deploy.md`
- **description:** Neeraj's organisation disallows API keys by policy, so a Google-hosted deployment must authenticate with Application Default Credentials. Vertex exposes an OpenAI-compatible chat-completions endpoint, so `client.ts` mostly survives — base URL becomes `https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/endpoints/openapi` and the `apiKey` slot takes a short-lived OAuth token instead of a static string.
- **the non-obvious part:** ADC issues **~1-hour tokens**, so the client cannot hold a fixed credential. It must mint and cache a token and refresh before expiry. `google-auth-library` is already installed for this. The same code path works unchanged in production against an attached service account, which is the main reason to prefer ADC over a key even where keys are allowed.
- **blocked on:** `gcloud` is not installed on the dev machine and `gcloud auth application-default login` is an interactive browser flow only the founder can complete. Also needs the GCP project id, region, and the chosen Gemini model.
- **tests:** token minting mocked; a request builds the right Vertex URL from project+location; an expired cached token triggers a refresh rather than a 401.

### T-FIX-006 · Generator context and prompt-level test coverage
- **status:** todo
- **sprint:** 2
- **severity:** medium — content quality; inflates the founder's QA time in T-024/T-045
- **depends_on:** T-005, T-006
- **files:** `backend/src/workers/generator.worker.ts`, `backend/src/generator/items.ts`, `backend/src/llm/prompts/items/user.md`, `backend/src/llm/client.ts`, tests
- **description:** Found by audit (2026-09-04). Three related gaps:
  1. **Item generation receives only the concept title.** `generator.worker.ts` calls `generateItems(concept.title)` — no parent topic, no `summary`, no prereqs. A concept titled "Dependency Array" or "Closures" reaches the model with no indication it belongs to "React Hooks", so ambiguous titles produce off-topic or generic questions. Pass topic title + concept summary (and consider prereq titles) and widen `items/user.md` to use them. Note the template variable is currently named `{{topic}}` but carries the *concept* title — rename while here.
  2. **No test asserts what is actually sent to the model.** Every generator test mocks the SDK boundary and asserts on the parsed response, so a broken `{{var}}`, a missing context field, or the empty-prompt-folder bug T-005 already hit once would all pass green. Add assertions on the rendered `system`/`user` strings.
  3. **`conceptMap/user.md` asks for 20–40 concepts but `MIN_CONCEPTS = 10`.** A 12-concept map passes silently and yields a thin 30-day course. Either raise the floor toward the asked range or document why the gap is deliberate.
  Also reword `client.ts`'s `SEED = 42` comment: with `temperature: 1` and `seed` best-effort on OpenAI-compatible endpoints, "the same prompt gives the same map twice" over-promises.
- **acceptance:** Items for an ambiguously-titled concept are generated with topic context present in the rendered prompt, asserted by a test.
- **tests:**
  - Rendered user message for `generateItems` contains the topic title and the concept summary.
  - Rendered user message for `generateConceptMap` contains the topic title.
  - A concept-map response below the enforced floor → `GenerationError`, with the floor and the prompt's asked range agreeing.

### T-062 · Retired items are still served outside `/due`
- **status:** todo
- **sprint:** 3
- **depends_on:** T-024
- **files:** `backend/src/modules/session/session.repository.ts`, `backend/src/modules/diagnostic/diagnostic.repository.ts`, `backend/src/modules/due/due.repository.ts`, their tests
- **description:** T-024 made `pnpm qa:retire` exclude an item from `GET /due`, but three other paths pick items straight out of the table and ignore `flagged_bad`: the session planner's post-teaching retrieval check (`findItemsForConcepts`), the diagnostic's per-concept picker, and — when it is written — T-038's test generator. A question the founder rejected as wrong is still asked in a session, and worse, could land in the Day-30 test, where it is scored.
  - Push the filter down to one shared helper rather than repeating `lt(items.flaggedBad, RETIRED_FLAG_THRESHOLD)` in four repositories, so T-038 gets it by default.
  - Decide the degenerate case deliberately: a concept whose every item is retired. The session must not hand back a concept with no retrieval item (`NewConceptSchema` requires one) — either skip the concept or fail generation loudly.
- **acceptance:** A retired item is unreachable from every surface: `/due`, `/session`, the diagnostic, and the Day-30/45 tests.
- **tests:**
  - A retired item never appears in `GET /session`'s `newConcepts` or `dueReviews`.
  - A retired item is never picked by the diagnostic.
  - A concept whose items are all retired does not produce a session entry with a missing item.
  - The shared helper is the only place the threshold is compared.

### T-063 · QA cannot fix a wrong misconception
- **status:** todo
- **sprint:** 4
- **depends_on:** T-024
- **files:** `backend/src/scripts/qa.ts`, `backend/src/scripts/__tests__/qa.test.ts`
- **description:** `concepts.corrections` (T-053's `[{ wrong, why }]`) is exported read-only, because a two-field list needs a separator that will not collide with the prose inside it. So a founder who spots a *wrong* misconception — one that teaches the learner a falsehood on the way to correcting it — has no way to fix it short of regenerating the concept. Round-trip it: one marker pair per correction field (`name=correction0.wrong`), or a small fenced block per correction with its own index. Deleting a correction must stay possible without breaking T-053's 2–4 range check.
- **acceptance:** A corrections edit round-trips like every other field, and a file that would leave a concept outside the 2–4 correction range aborts.
- **tests:**
  - Editing one correction's `why` updates only that entry.
  - Adding and removing a correction both work.
  - Dropping below 2 or above 4 corrections aborts with nothing written.

### T-067 · Push generation status over the WebSocket instead of polling
- **status:** todo
- **sprint:** 3
- **depends_on:** T-064, T-027
- **files:** `backend/src/ws.ts`, `backend/src/shared/schemas.ts`, `backend/src/workers/generator.worker.ts`, `frontend/src/store/`, tests in each
- **description:** `attachWebSocket` has been mounted at `/ws` since T-001 and still only answers `ping` → `pong`; `src/ws.ts` names "generation finished" as its first real event. The generation wait screen is the obvious candidate, and the transport is genuinely better: the worker runs **in the same process** as the HTTP and WebSocket server (`index.ts` builds both), so pushing is an in-process call — no Redis pub/sub, no second service.
  - **Why this is not the fix for T-064.** The bug there is that nothing *records* progress; a socket would push the same `0` the poll fetches. Transport is not the defect, and swapping it first would hide the real one.
  - **What it actually costs.** The socket has **no authentication** — every connection is accepted and gets `hello`. Pushing per-user topic progress over it requires authenticating the upgrade against the session cookie and routing events per user; without that, one learner's generation events reach every open socket. That is the real work, and it is a security boundary, not a refactor.
  - **It does not remove the fetch.** The wait screen's own copy says "you can close the tab and come back", so the page must still read state on load. WS removes the *repeated* request, not the first one.
  - **Do it when the socket serves two things, not one.** Sprint 3's extension wants pushed due-cards (T-028 currently plans an hourly poll); at that point the upgrade-auth work pays for itself twice and the event union is worth defining properly. With ten pilot users, a 15 s poll (T-066) costs nothing measurable, so this is a design investment, not a performance fix.
- **acceptance:** A socket is authenticated as a user before any event reaches it, generation events reach only that user's sockets, and the wait screen updates with no poll running.
- **tests:**
  - An unauthenticated upgrade is rejected.
  - A generation event for user A never arrives on user B's socket.
  - The client falls back to polling when the socket is closed or unavailable.

### T-069 · A topic can be stuck on `generating` forever
- **status:** todo
- **sprint:** 4
- **depends_on:** T-064
- **files:** `backend/src/workers/generator.worker.ts`, `backend/src/modules/topics/topics.service.ts`, `backend/src/scripts/`, tests
- **description:** `topics.status` is flipped to `active` or `failed` only by `processGenerationJob`. If the job never runs to completion — the worker process is killed mid-job (`tsx watch` restarting on a file save does this), the job is evicted, or Redis is flushed (T-068) — the row stays `generating` with no job behind it, forever. The onboarding screen polls it forever, and T-065's duplicate guard now makes it worse: a stuck topic **blocks the learner from creating any new one**.
  - Detection is cheap now that the job id is the topic id: `generating` **and** no job in the queue **and** older than a few minutes = stranded.
  - Decide the recovery deliberately — re-enqueue, or mark `failed` so the existing "That didn't build / Try again" path takes over. Failing loudly is the better default; a silent re-enqueue can double-spend on model calls if the job was actually alive.
  - A stranded row must not block `POST /topics` (T-065's guard), whichever recovery is chosen.
- **acceptance:** A topic whose job has vanished reaches a terminal state without anyone running SQL by hand, and never blocks a new topic.
- **tests:**
  - A `generating` topic with no job, older than the threshold, is marked `failed` with a reason that says so.
  - A `generating` topic **with** a live job is left alone, however long it has been running.
  - A stranded topic does not block `POST /topics` from creating a new one.

### T-075 · Response shapes are hand-written on the client
- **status:** todo
- **sprint:** 3
- **depends_on:** T-072
- **files:** `backend/src/shared/schemas.ts`, `frontend/src/features/*/[feature]Api.ts`, `backend/src/modules/*/[module].controller.ts`
- **description:** T-072 shipped a client type that claimed nine fields where the server sent four, and nothing caught it — because `TopicSummary` (and the same pattern elsewhere) is declared by hand in the feature's API file rather than inferred from a schema in `backend/src/shared`. plan.md §5 makes `backend/src/shared` the source of truth for shared types; response shapes quietly opted out of it.
  - Define the response schemas in shared (`TopicSummarySchema`, `SessionResponseSchema` already exists, `MapResponseSchema` already exists) and have each feature's API type be `z.infer` of it.
  - Have controllers parse their own response against the schema when `NODE_ENV !== 'production'`, so drift fails loudly in dev instead of arriving as `undefined` in a UI three screens away.
- **acceptance:** No response type is written by hand on the client, and a controller that drops a field fails in dev.
- **tests:**
  - Each controller's response parses against its shared schema.
  - Removing a field from a controller's select makes its test fail.

### T-077 · The knowledge score has no trend
- **status:** todo
- **sprint:** 4
- **depends_on:** T-017, T-040
- **files:** `backend/src/modules/map/map.service.ts`, `backend/src/lib/score.ts`, `frontend/src/features/map/pages/MapPage.tsx`
- **description:** Every artboard shows the score with a week-on-week delta — "67 ▲ 4 this week" — and plan.md §4 wants a number that visibly rises as recall improves. `GET /topics/:id/map` returns only today's score, so the delta cannot be rendered and the number sits there with no indication of direction. A score that never appears to move is the same motivational dead end as no score.
  - The data is already there: `predictedRecall` is a pure function of a card's FSRS state and a timestamp, so last week's score is the same computation over the same cards at `now - 7d`, restricted to concepts taught by then.
  - Decide what a delta means in week one, when most concepts were untaught seven days ago — probably "no delta yet" rather than a large fake gain.
- **acceptance:** The map shows the delta the design specifies, and it is right on a learner who has been going for two weeks.
- **tests:**
  - Score seven days ago is computed over concepts taught by then, not all of them.
  - A learner in their first week gets no delta rather than a misleading one.
  - `TrendUp` / `TrendDown` are chosen by sign, and a zero delta renders neither.

## Sprint 5 — Question formats (design done, not yet sequenced)

> **Where this sits in the build order.** `sprint.md`'s Build order runs `T-073` → `T-038`…`T-041` → the extension → the pilot dry run, and it runs that way because the measuring instrument does not exist yet. Nothing below changes that. `T-079` is done ahead of the queue only because it is additive, breaks nothing, and lets the rest be designed against a real schema; every task after it stays behind `T-041` unless the founder re-sequences deliberately.
>
> **Design canvases.** Code (8 artboards — block system, explaining a concept, missing code, write the code, the 20-second questions, entities & prompts, libraries, build spec): https://claude.ai/code/artifact/24dd7d4a-688c-49f7-9dbb-4b22709454f1 · System design (5 artboards — what's new, explaining a systems concept, fix the path, the cheap ones, build spec): https://claude.ai/code/artifact/6ec6fa41-62eb-4005-a4c7-f0c38528b20a · Maths drafted and paused in `design/maths/`, unpublished.
> Source in `design/code/`, `design/systems/`, `design/maths/`.
>
> **What this is for.** Every item today is a prompt string and a textarea, whatever the subject. All three pilot topics are code or systems topics (T-058), so the format the pilot measures retention *through* is the one format least suited to two of them: you cannot ask "where is the off-by-one" in a textarea. The bet is that a blank cut into real code is both a better question and a cheaper one — fifteen seconds against ninety — and cheaper questions are the ones that still get answered on day 26.

### T-081 · Founder call — CodeMirror on the client
- **status:** done — no client UI library
- **sprint:** 5
- **depends_on:** —
- **files:** `docs/loop.md`, `docs/plan.md`
- **description:** `loop.md §2` says "UI: plain React, inline styles or a single `styles.css` — no UI library for the pilot." The design for `codeEditor` (T-088) needs CodeMirror 6 in the browser, and it is a UI library by any reading. The argument for an exception is that these are content renderers rather than a component kit — nothing here supplies a button, a layout or a theme — and that three of the four packages in the design (`shiki`, `diff`, `katex`) stay in the generator worker precisely to hold that line. The argument against is that this is how "no UI library" becomes four of them. **This is a founder decision, not one a task should make quietly**, which is why it is written down rather than assumed. Blocks T-088 only; every other task in this sprint ships without it.
- **acceptance:** `loop.md §2` either carries a written exception naming the package and the screen, or T-088 is rewritten around a plain `<textarea>` with tab handling.
- **tests:** —
- **notes:** (2026-09-06) **Decided: no UI library on the client, and `codeEditor` is a plain `<textarea>` with tab and indent handling.** `loop.md §2` now carries the rule rather than the question.
  - The argument that made it easy came out of **T-088's own design**, not from a preference about dependencies. That design already turns off autocomplete, inline type hints and squiggles, because each is a retrieval cue and retrieval is what is being measured. What CodeMirror would still contribute is bracket matching and indent-on-newline — about thirty lines of `keydown` — plus syntax highlighting, which is itself arguably a cue: a keyword that fails to colour is feedback the design says should not be there. A large dependency for a very small remainder, on one block, on one screen.
  - Blast radius was already small: `codeEditor` is barred from the extension (T-089) and from the Day-30 test (T-093), so it only ever appears in a web session.
  - **Reversible and additive.** The data contract does not change, so if pilot participants struggle with a bare textarea that is evidence, and evidence can overturn this.
  - ⚠ **It does not settle `graphBuild`.** A textarea cannot substitute for drawing a graph, so T-108's deferred block still needs its own call — canvas, or a non-drawing answer format. Recorded in `loop.md` so the rule is not read as blanket permission.
  - The staleness this task also flagged — `loop.md §2` claiming inline styles — was already fixed during the design-system consolidation (T-090's successor).
- **notes (original):** Raised 2026-09-05 while designing the code category. Note that `loop.md §2` is already stale in the other direction: it says inline styles, and the frontend moved to SCSS classes under `src/styles/` some time ago — so this section needs a pass regardless.

### T-084 · Highlight in the worker, not the browser
- **status:** todo
- **sprint:** 5
- **depends_on:** T-083
- **files:** `backend/src/generator/highlight.ts`, `backend/src/generator/__tests__/highlight.test.ts`, `backend/package.json`
- **description:** `shiki` tokenises every `code`, `codeDiff` and `clozeCode` source once, in the generator worker, against a theme built from the five design-system colours (`#8A4225` keyword, `#4F7A5B` string, `#B8873A` number, `#A9A29B` comment, `#8A827A` punctuation) plus a dark variant for the retrieval card. What lands in `payload` is spans; the client ships no highlighter. A concept is generated once and read by ten learners across forty-five days, so this is the side of the wire the work belongs on.
- **acceptance:** No highlighting dependency in `frontend/package.json`. An unknown `lang` degrades to unstyled spans rather than failing the job.
- **tests:** Known language produces the expected token classes; unknown language produces one plain span and no throw; tokenisation is deterministic across two runs (the payload is cached content, so drift would show as a spurious diff).
- **notes:** One-line dependency reason for the commit: `shiki` — TextMate grammars, so highlighting is correct for every language a topic might use, run once at generation time.

### T-088 · Write the code
- **status:** done (rationing deferred — see notes)
- **sprint:** 5
- **depends_on:** T-085
- **files:** `frontend/src/components/blocks/CodeEditor.tsx`, `frontend/src/lib/runCases.ts`, `backend/src/modules/reviews/grade.ts`, tests alongside
- **description:** The design canvas's *Write the code* artboard. Deliberately not an IDE: **no autocomplete, no inline type hints, no squiggles while typing** — every one of them is a retrieval cue, and the retrieval is what is being measured. Bracket matching, indent-on-newline and undo stay; those are typing, not knowing. Cases are visible up front as the spec, and the first case passes with almost any attempt on purpose — starting from two reds and one green is a debugging problem, starting from three reds is a blank page. "Show me the shape" reveals a skeleton with the bodies blank and sets `review_events.assisted`, and the scheduler treats an assisted pass as a lapse whatever the cases say. JS and TS run for real in a `<iframe sandbox="allow-scripts">` on a blank `srcdoc` with a 2-second budget — no dependency, a real origin boundary, no cookies and no network. Every other language shows the identical screen with **Submit** and grades server-side. Rationed: at most one per session, never in a review, never in the extension.
  - ⚠ **The client never sees `cases[].expect` (decided in T-080), so the runner posts actual outputs and the server compares.** The expected output of three named cases largely gives the function away, and stripping it is also what makes the design's own goal reachable — a learner cannot tell a JS item from a Python one until they press the button, because both round-trip. `skeleton` is stripped for the same reason and is fetched only when "Show me the shape" is taken, which is the moment `assisted` is set.
  - **T-080 could not enforce "the first case passes the empty starter"** — it needs the code to run, so it lands here. It is worth keeping: three reds on the first run is a blank page rather than a debugging problem.
- **acceptance:** Autocomplete is off and asserted by a test, not by configuration alone. The sandbox cannot reach `document.cookie` or the network. An assisted pass writes `assisted = true` and schedules as a lapse. The client never receives an expected value for any case.
- **tests:** A correct implementation passes all cases; an infinite loop is killed at 2s and reports a timeout rather than hanging the tab; the sandbox has no access to the parent document; taking the hint sets `assisted`; the same concept's next review is a `clozeCode`, not this.
- **notes:** (2026-09-06) Built as a textarea, per T-081. **Unblocked. T-081 decided against a client UI library, so this is a plain `<textarea>`** with tab-inserts-spaces, indent-on-newline and bracket matching — about thirty lines of `keydown`. Native undo comes free.
  - That costs the design almost nothing, because it had already turned off autocomplete, type hints and squiggles as retrieval cues. Syntax highlighting goes too, on the same reasoning: a keyword that fails to colour is feedback.
  - Paths in `files` above predate the design-system consolidation — the component lives in `packages/ui/src/blocks/` and grading is `backend/src/lib/grade.ts`.
  - **`assisted` was a dead column before this**, exactly as `flagged_bad` was before T-117: `schema.ts` declared it with a comment explaining that the scheduler must treat an assisted pass as a lapse, and nothing wrote it or read it. It is now on `AnswerSchema`, written by `recordReview`, and turned into `Rating.Again` regardless of the cases going green. The event still records `correct` honestly — only the *schedule* treats it as a lapse, so the two remain distinguishable in the numbers.
  - **`assisted` is client-reported and that is safe**, unlike `correct`. It can only ever count against the learner, so there is nothing to gain by lying; `correct` is graded server-side precisely because it can be inflated.
  - **The skeleton is fetched, never shipped** — `GET /items/:id/skeleton`. It is most of the answer, so putting it in the payload would hand it to everyone including those who never asked, and `assisted` would then measure who clicked a button rather than who needed help. A test asserts neither it nor `cases[].expect` appears in what `/due` serves.
  - **The sandbox is an `<iframe sandbox="allow-scripts">` on a blank `srcdoc`, not `eval`.** `allow-same-origin` is deliberately absent — with it the sandbox is not one. The frame gets an opaque origin: no cookies, no storage, no parent document, no session to steal. Two seconds, then it is destroyed, because `while(true)` is the most common wrong answer to a loop question and a hung tab loses the learner's work.
  - Every value is stringified **inside** the frame: `postMessage` structured-clones, and a function or a cyclic object would throw there rather than here, losing the run for a reason the learner cannot act on.
  - Non-JS languages show the identical screen with **Submit** and are judged server-side, so a learner cannot tell a JavaScript item from a Python one until the verdict returns.
  - ✅ **Deferred: the rationing** — "at most one per session, never in a review, never in the extension". Done in **T-115**. The extension half is already enforced by `popupEligible` (T-089) and the Day-30 half by T-093, but nothing limits it to one per web session or keeps it out of reviews. That belongs in the session planner, not in the block, and is worth its own task.
  - ⚠ **Deferred: "the same concept's next review is a `clozeCode`, not this"** — the acceptance names it, and it needs the item picker to know what format was last served. Also planner work.

### T-092 · Topic profile — the decisions that are per-topic, not per-concept
- **status:** todo
- **sprint:** 5
- **depends_on:** T-082, T-095
- **files:** `backend/src/llm/prompts/topicProfile/{system,user,example}.md`, `backend/src/generator/topicProfile.ts`, `backend/src/shared/schemas.ts`, `backend/src/workers/*`, `backend/fixtures/`, tests alongside
- **description:** One model call per topic, between the concept map and the items, that fixes what the whole topic has to agree about. T-091 supplies the language when the learner gave one; this call supplies the rest, which a learner could not:
  - `styleNotes` — the house style the listings follow: `const` over `let`, `async/await` over `.then`, whether errors are thrown or returned. Forty independent style decisions read to a learner as "this course was generated", without their being able to say why.
  - `componentVocabulary` — for a `systems` topic, the node names the renderer knows how to draw. A diagram naming a component the layout code has never heard of is a broken picture, and the model has no other way to find out what exists.
  - the metadata keys the learner left unset — `language` among them — each recorded as inferred (`inferred: ['language']`) so content QA can see which topics were guessed at. T-091 named this as `topics.language`; `T-095` generalises it to `topics.metadata`, and the rule is unchanged: when the learner answered, nothing infers anything.
  - **Why not in the concept-map call.** That call is already the longest and most expensive in the pipeline (`sol`), and its output is the foundation the whole thirty days is built on. Asking it to also fix a house style is how a 40-concept map quietly comes back with 22.
  - **Why not in the item calls.** Consistency across a topic is exactly what a per-concept call structurally cannot decide — that is the entire reason this step exists.
- **acceptance:** One extra call per topic (74 against T-074's measured 73). Every item and teaching call receives the profile. A topic whose profile call fails retries once and then fails the job loudly, as every other generated artifact does.
- **tests:** Fixture parses; a profile missing `styleNotes` is rejected; `componentVocabulary` is required when any concept's domain is `systems` and absent otherwise; a learner-set language is passed through untouched and sets `languageInferred: false`; the rendered item prompt contains the profile.
- **notes:**

### T-094 · Nothing checks that generated content is in the language that was asked for
- **status:** todo
- **sprint:** 5
- **depends_on:** T-095, T-092
- **files:** `backend/src/generator/items.ts`, `backend/src/generator/teaching.ts`, `backend/src/modules/qa/*` (T-024's), tests alongside
- **description:** T-091 threads the learner's language into every item and teaching prompt, and that is the whole enforcement: an instruction. Every other generated artifact in this pipeline is Zod-validated and domain-checked before it is stored — a rubric over 200 characters, a `transferCount` of three, a missing `isTransfer` — and this one is not checked at all.
  - It matters more than a style slip. The failure T-091 exists to prevent is silent: a learner asks for Python, forty independent calls mostly comply, and two concepts come back in JavaScript. Nobody sees it until Day 12, and by then the item is scheduled and its `review_events` are already in the retention measurement.
  - **Where the check can live.** `validateItems` cannot read a language out of a prompt string today — that only becomes checkable once `T-080` puts real listings in `blocks`, where a block carries its own `language`. So the cheap, correct version is: assert every `code` block's declared language matches the topic's `metadata.language`, at parse time, in the same place every other domain rule lives. Prose is not checked; a mention of "the JS version" in an explanation is not a defect.
  - **The QA tool is the other half** (T-024). A topic's QA view should name the language and flag any concept whose blocks disagree, because the model *declaring* `python` on a block of JavaScript is a failure this check cannot catch and a human reading it can.
  - Depends on T-092 as well as T-091: for a topic whose language was inferred rather than chosen, the profile's language is the one to check against, and `languageInferred` is what tells QA to look harder.
- **acceptance:** An item whose `code` block declares a language other than the topic's is rejected inside the retry loop, so it costs one more call rather than the whole topic — the treatment T-FIX-011 established for this class. A topic with no language checks nothing and generates exactly as it does today.
- **tests:**
  - A generated item carrying a `code` block in the wrong language is rejected with a `GenerationError` naming the language mismatch.
  - The same item is accepted when the topic has no language.
  - The rejection happens inside the retry loop: a first response in the wrong language and a second in the right one succeeds, one extra call, no failed topic.
  - Teaching content is checked the same way as items — the worked example an `example_first` concept must contain is the other place a stray language lands.
  - QA lists the topic's language and flags a concept whose blocks disagree.
- **notes:**

### T-095 · Schema — `topics.metadata`, superseding `topics.language` (schema task)
- **status:** todo
- **sprint:** 5
- **depends_on:** T-091
- **files:** `backend/src/db/schema.ts`, `backend/src/db/__tests__/schema.test.ts`, `backend/src/shared/schemas.ts`, `backend/src/modules/topics/*`, `backend/src/generator/*`, `backend/src/llm/prompts/{items,teaching}/user.md`, tests alongside
- **description:** Founder decision (Neeraj, 2026-09-05). `topics.language` shipped one commit ago and the column is the part of T-091 that does not generalise: it assumes every topic has a language-shaped unknown. *Dynamic programming* has one. *CAP theorem* has "which datastores do you actually run", so the examples land on Postgres rather than a toy. A Spanish topic has Castilian-versus-Latin-American; a Kubernetes topic has which cloud. One named column is right for two of the three pilot topics and wrong for everything outside them.
  - `topics.metadata jsonb not null default '{}'`, keyed by the probe's question keys (T-096). `topics.language` is dropped; **`language` becomes a documented reserved key** so `T-094`'s verifier, the QA tool and the prompts all still have one agreed name for it.
  - **What survives from T-091 untouched:** `render()`'s `{{#var}}…{{/var}}` optional sections, the threading of learner choice into every item and teaching call, and the rule that a value absent means nobody said — which is now an absent *key* rather than a null column. Only the column and the hardcoded six-language list are superseded. Say so in T-091's notes rather than quietly rewriting it.
  - **The prompt line becomes a block, not a line.** One `{{#metadata}}` section wrapping a rendered `key: value` list, so a topic with three answers and a topic with none both produce sensible prompts. The optional-section machinery is what makes the empty case cost nothing.
  - `default '{}'` and `not null`, unlike `topics.language`: an empty object and an absent key already express "nobody said", so there is no third state for null to carry and a nullable jsonb would only invite `metadata?.language` everywhere.
- **acceptance:** A topic created with metadata carries every key into every item and teaching prompt; one created without generates exactly as it does today. `pnpm db:push` and `pnpm db:test:push` apply with no prompts. No column named `language` remains on `topics`.
- **tests:**
  - `topics.metadata` defaults to `{}`; a topic inserted without one round-trips as `{}`, and an explicit null is rejected.
  - Arbitrary keys round-trip, including one whose value contains `<` and `>` — escaped in the rendered prompt like every other learner-supplied value.
  - The rendered item prompt contains every key and value when metadata is non-empty, and no metadata block at all when it is `{}` — asserted on the prompt, not the vars object.
  - Same for the teaching prompt: an `example_first` concept's worked example is the other place a stray convention lands.
  - Regression: T-091's `{{#var}}` behaviour is unchanged — an unclosed section still throws, a section var never supplied still throws.
- **notes:**

### T-096 · Topic probe — one cheap call decides what to ask the learner
- **status:** todo
- **sprint:** 5
- **depends_on:** T-095
- **files:** `backend/src/llm/prompts/topicProbe/{system,user,example}.md`, `backend/src/generator/topicProbe.ts`, `backend/src/modules/topics/*`, `backend/src/shared/schemas.ts`, `backend/fixtures/`, `frontend/src/features/onboarding/*`, tests alongside
- **description:** The other half of the split T-095 opens up. There are two kinds of per-topic unknown and they divide by **who can answer them**: what only the learner can say (a preference about the material) and what only the model can say (house style, component vocabulary — that is T-092, and it runs in the worker where nobody is waiting). This task is the first half: one cheap call on the topic *string*, before the topic exists, that returns what is worth asking.
  - `POST /topics/probe`, synchronous, `gpt-5.6-luna` at `reasoning_effort: none`. Against the ~73 calls T-074 measured for a topic this rounds to nothing, and a learner is watching, so latency is the constraint rather than cost.
  - Returns `{ understood, viable, narrower[], domain, questions[] }`. `questions` is **0–3**, each `{ key, prompt, options[2-6], allowOther }`, every one skippable in one tap. Zero is a normal answer — *CAP theorem* may well have nothing worth asking, and onboarding is where a ten-person pilot loses two of them.
  - **The viability verdict is worth more than the metadata.** `TopicCreateSchema` accepts any 2–120 character string today and immediately enqueues a job that spends ~73 model calls over five to ten minutes; `asdf` passes, and so does "everything about physics". The learner finds out ten minutes later on a wait screen. `too_broad` comes back with 2–4 narrowings ("Physics is a degree — did you mean *Newtonian mechanics* or *special relativity*?"), `too_narrow` says it cannot fill thirty days, `not_teachable` covers a private internal system with no public knowledge to draw on. All three are recoverable **while the learner is still on the screen**, which is the whole reason this call runs before creation rather than inside the worker.
  - `domain` is a topic-level hint, not an answer: `T-082` still classifies each concept, because a topic called *Dynamic programming* contains concepts whose correct answer is prose.
  - **The §3.1 guard ships with this task and cannot be deferred.** A model asked "what should we ask this learner?" will propose *"Do you prefer worked examples or figuring it out yourself?"* — it is the most natural question in the space, `plan.md §3.1` and `CLAUDE.md` ban it outright, and it would also let the learner self-select into `teach_mode` and destroy the §3.4 A/B, which is the pilot's second measurement. A prompt instruction is not enough on its own.
    - **The shape rule:** a valid question names a property *of the subject matter* whose answer values could literally appear in a listing, an example or a diagram. "Which language" qualifies — the value shows up in every snippet. "How fast do you want to go" has no such value anywhere in the material.
    - **The mechanical backstop:** a deny-list over the question and option text — learn, prefer, style, pace, difficulty, easy/hard, level, beginner/intermediate/advanced, experience, familiar, comfortable, remind, schedule, motivat, goal, visual, auditory. Experience level is banned for its own reason as well as §3.1's: the diagnostic measures prior knowledge properly (plan.md §3.3), and a self-report would be a worse signal competing with it.
    - **A tripped question is dropped, never the topic.** The list is blunt and will false-positive on an ML topic ("which learning rate schedule" trips twice). That asymmetry is deliberate: a false positive costs one unasked question, a false negative costs a violated founder rule and a corrupted A/B. Every generated question is logged into the QA export either way, so the first few topics can be read by hand.
  - **Injection surface:** the topic title already reaches a prompt escaped and tagged as data (T-091). The probe adds a second call over the same string and gets the same treatment; additionally, nothing the probe *returns* may be treated as an instruction — the questions are rendered as UI, and the answers land in `topics.metadata` as data.
- **acceptance:** A viable topic yields 0–3 material questions and creates normally. A non-viable one never reaches `POST /topics` and never costs a generation. No returned question survives the guard if it asks about the learner rather than the material. The onboarding step renders whatever comes back without knowing any topic in advance.
- **tests:**
  - Fixtures for all four verdicts parse; `too_broad` without `narrower` is rejected.
  - *Dynamic programming* yields a language question; *CAP theorem* yields zero or a systems question, never a language one — asserted against fixtures, not the live API.
  - Every §3.1-banned phrasing in a table of ~15 examples is dropped, and the topic still creates with the surviving questions.
  - A question whose text contains an ML false positive is dropped rather than failing the call — documented as accepted behaviour, not a bug.
  - The rendered onboarding step submits `metadata` keyed by the returned `key`s, and omits a key the learner skipped.
  - A probe response is never rendered as markup or instructions anywhere.
  - The probe is not called from the worker, and generation is unchanged when it is skipped entirely.
- **notes:**

### T-097 · Pinned probe output for the three pilot topics
- **status:** todo
- **sprint:** 5
- **depends_on:** T-096
- **files:** `frontend/src/features/onboarding/topics.ts`, `backend/src/modules/topics/*`, tests alongside
- **description:** Two learners typing *Dynamic programming* must get **identical questions and identical material**, or the five people on that topic are not on the same topic and the taught-versus-held-out comparison is comparing across different courses. A generated probe is not deterministic enough to promise that.
  - So the pilot's three topics carry hand-written pinned probe output, checked into `topics.ts` next to `PILOT_TOPICS`, and the probe call is **skipped entirely** for them. Free-text topics get the model. That also keeps the model out of the pilot's critical path, which is worth having on its own.
  - This is the same argument that made `recommendTopic` a lookup rather than a call, and it lapses at the same moment: when T-058 makes topics per-learner, there is no fixed set left to pin.
- **acceptance:** Creating any of the three pilot topics makes zero probe calls and produces byte-identical questions every time. Any other title goes to the model.
- **tests:** A pilot title never calls the probe; a non-pilot title always does; two creations of the same pilot title produce identical metadata keys and options.
- **notes:**

### T-098 · Automated QA critic pass over generated items
- **status:** todo
- **sprint:** 5
- **depends_on:** T-024, T-045
- **files:** `backend/src/llm/prompts/itemCritic/`, `backend/src/generator/critic.ts`, `backend/src/scripts/qa.ts`, tests alongside
- **description:** **The gate that free-text topics are blocked behind.** T-024 measures ~1 hour of hand-review per topic and T-045 has the founder reading every question in both pilot topics. Ten bespoke topics is ten hours on material nobody has checked — and unreviewed questions make the retention number meaningless, which is the only thing the pilot exists to produce. Either the review scales or free text does not ship.
  - A second cheap pass over each generated item, checking the five things hand-review actually catches: the answer key is correct; no distractor is accidentally also correct; the prompt is unambiguous without context, days later; the explanation does not contradict the item; a `isTransfer` item genuinely applies the idea in a new context rather than restating it.
  - Output is **flags and a confidence, not a verdict** — it reorders the QA export so the human reads the suspicious items first. Auto-retiring on a model's say-so would let one cheap call silently delete the measurement.
  - **It has ground truth, which is unusual and should be used.** T-045 hand-QAs both pilot topics and records what it found. Run the critic over exactly that material and measure precision and recall against the founder's real findings. A critic that misses half the wrong answer keys is not a gate, and this is the one moment where that can be known rather than assumed.
- **acceptance:** The critic's flags are measured against T-045's hand-review on the same two topics, with the numbers written into this task's notes. A stated recall threshold on wrong answer keys is met before free-text topics are enabled.
- **tests:**
  - A fixture item with a deliberately wrong answer key is flagged; a correct one is not.
  - A recognition item with two defensible options is flagged as an ambiguous distractor.
  - A restated-not-transferred `isTransfer` item is flagged.
  - The QA export orders flagged items first and states why each was flagged.
  - The critic never mutates or retires an item — it only annotates.
- **notes:**

### T-099 · Reveal blocks are written and never seen
- **status:** todo
- **sprint:** 5
- **depends_on:** T-080, T-085
- **files:** `backend/src/modules/reviews/*`, `backend/src/shared/schemas.ts`, `frontend/src/components/blocks/*`, tests alongside
- **description:** Found while building T-080. A block in the `reveal` slot is shown only *after* answering — the working version of the listing, the real terminal output, the one-line diff that names what was missing. `toPublicBlocks` correctly refuses to send one with the question, because a reveal block **is** the answer. Nothing sends it afterwards either, so today the generator can write one and no learner will ever see it.
  - **It rides the answer response, not a second request.** `POST /reviews` already returns `{ correct, feedback }` and the screen already re-renders on it. Adding `revealBlocks` there costs no round trip and no new route, and it means the reveal cannot arrive before the answer by construction — a separate `GET` would be one guessed URL away from being the answer key.
  - **Only for the item that was just answered, and only after it was answered.** The same fail-closed shape as `toPublicItem`: the reveal is built from the stored payload at response time, never cached alongside the public item.
  - **It is the whole point of the expensive formats.** The design's *Write the code* screen ends on a two-line diff explaining that the timer handle had to be *assigned* — that sentence is what the four minutes bought. Without this the learner gets a red or a green and no explanation.
- **acceptance:** Answering an item with reveal blocks returns them; answering one without returns no `revealBlocks` key at all. No reveal block is reachable before an answer is posted for that item.
- **tests:**
  - `POST /reviews` for an item with two reveal blocks returns both, projected through the same stripper as every other block.
  - An item with no reveal blocks returns a response byte-identical to today's.
  - The public item for the same question still contains no reveal block (regression on T-080's projection).
  - A reveal block on an item the user has not answered is not returned.
  - The renderer shows reveal blocks only once feedback is present.
- **notes:**

### T-100 · Slow DB tests blow the 5s default timeout and truncate tables under still-running work
- **status:** todo
- **sprint:** 5
- **severity:** low to ship, high to trust — an intermittently red suite trains everyone to re-run it, and the next real regression gets re-run too
- **depends_on:** T-014
- **files:** `backend/src/modules/users/users.test.ts`, `backend/src/modules/users/*`, `backend/src/test/db.ts`, `backend/vitest.config.ts`
- **description:** Observed while verifying T-083. `PATCH /me > rejects an invalid patch without writing anything` failed once in a clean serial `pnpm test`, and passed in the twelve full runs before and after it. Nothing in T-083 touches the users module or its test.
  - **A second sighting sharpened it.** `sprint2 > never leaks a held-out concept` failed with **401** partway through `runDiagnostic`, after `/diagnostic/:id/start` had already returned 200 with the same cookie. Both known failures are 401s, and 401 here means one thing: **the `sessions` row was gone mid-test.** Nothing in the codebase deletes or revokes a session except `endSession` (only reachable from `/auth/logout`) and `truncateAll`, which runs in a `beforeEach`.
  - **Leading hypothesis — the 5-second default timeout.** `vitest.config.ts` sets no `testTimeout`, so it is vitest's default **5000ms**, and no suite overrides it. The sprint2 tests do a great deal inside one test: `truncateAll` (13 sequential TRUNCATEs) + a Redis `obliterate` + a magic-link round trip + `processGenerationJob` inline for a 12-concept map + a 15-step diagnostic, each an HTTP round trip. Under a full run — machine busier — that plausibly crosses 5s. When it does, **vitest fails the test and moves on, but the abandoned promise chain keeps running**, because a JS promise cannot be cancelled. The next test's `beforeEach` then truncates the tables underneath that in-flight work, and it starts getting 401s. That explains every observation: intermittent, only in a full run, a different test each time, and always an auth failure rather than a data mismatch.
  - **What is already ruled out.** Not file parallelism — `fileParallelism: false` is already set precisely because these tests share one Postgres. Not the test itself: `users.test.ts` passes 8/8 when run alone. Not the rate limiter (T-FIX-007), which keys on email and `seedUser` mints a unique address per call. Not session expiry — `SESSION_TTL_DAYS` defaults to 30.
  - ✅ **Confirmed (2026-09-06).** `testTimeout: 20_000` set in `vitest.config.ts`; the run that had just failed on `sprint2 > never leaks a held-out concept` came back **489/489**. One green run is evidence, not proof — the acceptance below still wants twenty — but the mechanism is no longer a hypothesis.
  - **What is left.** (a) Confirm over ~20 runs. (b) The concurrency half below, which is reproducible and untouched. (c) The real fix underneath: the sprint integration tests are slow enough to approach a 5s budget in the first place, and 20s is headroom rather than a cure. **Do not raise the timeout again if something fails** — that is `test.retry` one step removed, and it would hide exactly the shared-state bug worth finding.
  - **Do not "fix" it by retrying.** `test.retry` would hide exactly the class of bug worth finding: shared state leaking between test files against one database. The pilot's whole measurement runs through this code path.
  - **Separately, and reproducibly: two `pnpm test` runs at once destroy each other.** Sixty-three tests fail with mismatched row counts and stray 401s, because every file's `beforeEach` truncates the same tables. T-068 gave Redis its own namespace for exactly this reason; Postgres never got the same treatment. Anyone running the suite in two terminals — or CI running two jobs on one database — sees what looks like sixty-three unrelated bugs. A per-run database name (or a schema per worker) would end it.
- **acceptance:** Twenty consecutive full runs are green, and the cause is written here rather than worked around. Two concurrent `pnpm test` runs both pass.
- **tests:** A loop of ≥20 full runs is green. Two suites started simultaneously both pass, asserted by running them.
- **notes:**

### T-103 · The two clients disagree about vite
- **status:** todo
- **sprint:** 5
- **depends_on:** T-102
- **files:** `frontend/package.json`, `extension/package.json`, `pnpm-workspace.yaml`
- **description:** Found by T-102. `extension/pnpm-workspace.yaml` carried `overrides: { vite: ^7.3.6, '@vitejs/plugin-react': ^4.4.1 }` while `frontend/package.json` depends on `vite: ^6.3.5`. Three lockfiles let both be true at once; one workspace cannot, because a pnpm override is workspace-global.
  - The override is **deliberately not reproduced** at the root — applying it would drag the web app onto a new vite major nobody asked for. WXT resolves its own vite either way, and everything builds today.
  - What is unknown is *why* the extension pinned vite 7. If it was working around a WXT bug, that workaround is currently gone. Find out before assuming this is cosmetic.
- **acceptance:** Both clients are on the same vite major, or there is a written reason they are not.
- **tests:**
  - `pnpm build` passes in both clients.
  - `docker compose run --rm extension` still produces a loadable zip.
- **notes:**

### T-108 · The systems category — the answer is a shape
- **status:** done (graphBuild deferred)
- **sprint:** 5
- **depends_on:** T-085
- **files:** `packages/shared/src/blocks.ts`, `backend/src/llm/prompts/items/domains/systems.md`, `packages/ui/styles/_code-palette.scss`, `packages/ui/src/blocks/*`, worker SVG renderer, tests
- **description:** Raised by the founder (2026-09-06). `ConceptDomainSchema` has four domains — `code | math | systems | prose` — and only `code` has a prompt fragment or any block that fits it. **Every block kind in the union is code-shaped:** `prose · code · codeDiff · terminal · clozeCode · hotspotLine · orderLines · codeEditor`. A `systems` concept today falls back to a prompt string and a textarea, which is the exact failure T-079/T-080 fixed for code.
  - **This one is in the pilot.** *Consistency in distributed systems* is one of the three pinned topics (T-097), so this is the category whose absence a real learner feels. **Maths is not in the pilot** — see T-109, which is why these are separate tasks.
  - **Already designed in full**: `design/systems/` — Main, Spec, Build, Explain, Trace. Do not redesign; read the canvas.
  - **Four blocks, two genuinely new** (the design's own measure of whether the abstraction held):
    - `diagram` (context, new) — nodes and edges, **rendered to SVG in the worker**, because a diagram you only read does not need a graph library on the client. Extension-safe at ≤5 nodes.
    - `sequence` (context, new) — lanes and messages down a time axis. Half of distributed systems is an interleaving: a stale read is not a picture of boxes, it is two orders of events. Extension-safe at 2 lanes.
    - `graphBuild` (answer, new) — place a component or draw an edge. **The one genuinely new grader**: the answer is a graph, so grading asks whether the read path goes through the primary, not whether two strings match. 45–90s, and it needs a canvas on the client.
    - `numeric` (answer, new, **shared with maths**) — a number with a tolerance. `accept: string[]` cannot express this: `6GB`, `6e9` and `6,000,000,000` are one answer with infinitely many spellings, and a capacity estimate wants an order of magnitude rather than equality. Specified once here, consumed by T-109.
  - **Everything else ports unchanged**: `hotspot` targets a node or an edge instead of a line, `orderLines` orders protocol steps instead of statements, and `recognition`, `explain` and the whole reveal slot are identical.
- **acceptance:** A `systems` concept generates items using the new blocks; a diagram renders from worker-generated SVG with no client graph library; `pnpm build` passes.
- **tests:** Generation schema accepts the four new blocks and rejects a `graphBuild` in a non-answer slot; the worker's SVG output and the live renderer read the same five token names; `numeric` accepts a value inside tolerance and rejects one outside.
- **notes:** (2026-09-06) **Three of four built; `graphBuild` deferred** on the founder's call, because it is the only one needing a canvas in the browser. `diagram`, `sequence` and `numeric` need none, so the category produces real content today.
  - **The model emits meaning; the worker draws.** Generation carries nodes and edges, or lanes and messages; `generator/systemsSvg.ts` renders the SVG into the stored form. A model asked for SVG writes bad SVG. This is the same discipline as T-084's highlighting, and it is why reading a diagram costs no graph library.
  - **The SVG uses `var(--…)`, never literals.** Five token names from `_code-palette.scss`, so one stored drawing is correct on paper and on ink. A hardcoded `#c9c2b9` would be a light-mode diagram burned into the database. Asserted by a test that rejects any hex in the output.
  - **Five nodes is a schema cap, not a suggestion.** Capping there rather than adding a second `short` variant makes every diagram extension-safe by construction — and a concept needing six boxes has not been split into one idea yet.
  - **Three guards caught real gaps while wiring it**, all working as designed: the exhaustive `toPublicBlock` switch refused to compile until each new kind declared what reaches the client; the JSON-schema drift test refused until the provider was offered the same kinds Zod accepts; and `.strict()` on the generation union rejects an `svg` from the model, which is tested directly.
  - **One guard was over-broad and is now scoped.** "Never offers the model a line number" matched `"from"`/`"to"` anywhere in the blob, and `diagram.edges` uses those for node ids. A dangling node reference is dropped when the drawing renders — a visible absence, not a silently wrong annotation — so the guard now checks only the variants carrying a listing, which is what its own comment says it protects.
  - `domainFragment` now names `systems`; `math` stays absent on purpose, with a test asserting the file does not exist, because `loadTemplate` treats a missing fragment as a no-op and naming it early would silently serve the generic prompt while the code claimed otherwise.
- **Still open:** ⚠ **`graphBuild` needs a graph/canvas library in the browser, which `loop.md §2` bars.** That is the same decision as **T-081** (CodeMirror), which is logged as blocking `T-088` only — it does not: it gates this too, and unlike T-088 this category is in the pilot. **T-081's scope is wrong and its priority is understated.**
  - The build spec says tokens append to `src/styles/_code-palette.scss`. That path is now `packages/ui/styles/_code-palette.scss` (T-090 → the design-system move). The design predates it.

### T-109 · The maths category
- **status:** todo
- **sprint:** post-pilot
- **depends_on:** T-108
- **files:** `backend/src/llm/prompts/items/domains/math.md`, `packages/shared/src/blocks.ts`, tests
- **description:** The fourth domain, and the only one not represented at all. Designed at `design/maths/` — Main, Explain, FillIn.
  - **Deliberately after the pilot.** None of the three pinned topics is a maths topic, so a `math` concept arising inside a code or systems topic is rare and falls back to `prose` acceptably. The design says as much.
  - Its `numeric` block is specified once, in T-108, because systems needs the identical thing — a number with a tolerance rather than a string match.
- **acceptance:** A `math` concept generates items that ask for a value or a derivation rather than a sentence about one.
- **tests:** `math.md` composes via `loadTemplate(name, fragment)` with no code change (T-083 built the mechanism and a missing fragment is already a no-op).
- **notes:**

### T-110 · `delayed` was never reached — the classifier sent those concepts elsewhere
- **status:** done (unverified — see notes)
- **sprint:** 5
- **depends_on:** T-108
- **files:** `backend/src/llm/prompts/conceptMap/system.md`, `backend/src/llm/prompts/items/domains/systems.md`, `backend/src/generator/systemsSvg.ts`, `backend/src/generator/conceptMap.ts`, tests alongside
- **description:** The first real `systems` generation produced two sequences and **not one `delayed: true`**, which is the flag the whole block exists for — a stale read is an interleaving, not a picture of boxes. The obvious move was to push harder on `systems.md`. That would not have worked.
  - **The generator was right.** It drew *Happens-before* and *Linearizability*, and both are concepts where the ordering **holds**. A delayed message there would draw a violation and then ask why the rule is satisfied.
  - **The concepts that wanted one never saw the fragment.** *Stale reads*, *Eventual consistency* and *Read-your-writes consistency* were all classified **`prose`**, so they were generated with the generic prompt and had no blocks available at all. `domain` decides which formats a concept can be asked with, so a mis-filed concept silently never gets the format that would have taught it.
  - Fixed at both ends: the classifier now carries a worked contrast that **a concept whose answer is an *ordering* is `systems`, even when it could be described in a sentence** — "could I write a sentence about it?" is not the question, because almost anything can be described in prose. And `delayed` is now a decision made every time (is the concept the thing working, or the thing failing?) rather than a note under an example.
- **acceptance:** Stale reads, eventual consistency and read-your-writes classify as `systems`; a sequence drawn for a failure carries exactly one `delayed: true`.
- **tests:** 475 backend. **The acceptance criteria above are not among them** — see notes.
- **notes:** (2026-09-06) **Unverified.** Three regeneration attempts failed and the cause is environmental, not code: Node's `fetch` cannot reach the provider from this machine while `curl` can. Isolated as far as it goes — `curl` gets 200s and real completions, Node reaches github fine, Node's raw TCP connects to the provider's IPs in under 300ms, but Node `fetch` returns `ETIMEDOUT` in ~500ms every time, and `curl -6` fails instantly. The IPv6 route to that host is dead and undici keeps taking it; `dns.setDefaultResultOrder('ipv4first')` does not help because undici resolves independently of it. Founder is fixing the network. **Re-run a distributed-systems generation and check the two acceptance criteria before trusting this.**
  - **Three rendering bugs the real output found**, none of which a hand-written test would have caught: self-messages (`Node B → Node B`, a standard idiom the generator reaches for unprompted) were **silently dropped**, taking half of one diagram with them; a self-message on the last lane had its label clipped off the canvas; and `width="100%"` stretched a 414px drawing across an 800px column and doubled every label. All three now have tests, and the canvas measures its overhang rather than padding by a guess.
  - **Two stale things found while debugging.** The concept-count warning still read *"20–40 … thin for a 30-day course"*, so every correct 16-concept map warned; it now reads 14–16 and gains the opposite check that did not exist — above 21 a 7-day course cannot finish the map, which is exactly the risk T-104 introduced. And a provider `Connection error` is reported with reason **`invalid_shape`**, which would send the next person debugging in entirely the wrong direction. Not fixed here; worth its own task.

### T-111 · Backend tests flaked under parallel load
- **status:** fix written, unverified
- **sprint:** 5
- **depends_on:** —
- **files:** `backend/vitest.config.ts`, `backend/src/test/*`
- **description:** **Two** distinct failures in one session, each passing on a re-run with no code change between: `dev.test.ts` ("scope=progress keeps the generated course") failed with a 401, and `session.test.ts` ("rejects a concept that was not offered today") failed once. Both were during runs that touched no backend code at all.
  - *(Originally logged as three. The third, a `jsonSchemas` case, was a **real** failure — new block kinds added to the Zod union without the provider schema. Mislabelling a genuine failure as flakiness is the more expensive mistake of the two, so it is corrected here rather than quietly dropped.)*
  - **T-100 fixed one class of this** — vitest's 5s default timeout on the DB suites — and marked it done. This is a different one, or the same one incompletely fixed.
  - A suite that fails one run in five teaches people to re-run rather than read, and the day it catches something real it will be re-run too. That is the cost, not the minute it wastes.
  - Likely candidates: shared Postgres state between parallel files (`truncateAll` racing another file's insert), or Redis db 1 shared across workers despite T-068.
- **acceptance:** The backend suite passes twenty consecutive runs.
- **tests:** —
- **notes:** (2026-09-06) Two defects found by reading, not by re-running — the fix is unverified until the suite is run repeatedly, which is the founder's to do.
  - **`truncateAll` issued one `TRUNCATE` per table — thirteen round trips before every test.** Each gap between them is a window in which a request still in flight from the previous test observes a half-emptied database, comes back 401, and surfaces as a random auth failure somewhere unrelated. That is T-100's race seen from the other end. Postgres truncates a list atomically, so it is now one statement: no half-emptied state to observe, and the window is one round trip instead of thirteen.
  - **`hookTimeout` was never set, so it defaulted to 10s** — half the configured `testTimeout`, on a hook that does a database round trip before every test in the suite. A timed-out hook is worse than a timed-out test: vitest reports it against whichever test came next, and the tables are left in whatever state the truncate reached. Now explicit at 20s.
  - Both attack the same mechanism rather than papering over it. **No retries were added on purpose**: a retry makes a flaky suite quiet, not honest, and the day it hides something real is the day it costs the most.


- **Additional observation (2026-09-06, before day-30 changes):** The unchanged baseline failed `auth.test.ts > rejects a malformed email` with `socket hang up`; 649/650 tests passed. The later full workspace run passed all 670 tests. This is recorded as another observation, not a claim that the flake is fixed.

### T-113 · Day-0 controls are unmeasured, so a held-out change score would be invented
- **status:** todo
- **sprint:** 4
- **depends_on:** T-015, T-038
- **files:** `backend/src/modules/diagnostic/*`, future T-040 metrics, pilot protocol in `docs/plan.md`
- **description:** Found while wiring the cold-test scores. T-015 explicitly never asks held-out concepts, and its `day0.scores.perConcept` contains only non-held-out concepts (with adaptive estimates for some). Plan.md asks for held-out concepts to stay flat from Day-0 to Day-30; that baseline was never observed. T-040 must not manufacture it from zero or a default estimate. Resolve the pilot protocol: either retain a Day-30 taught-vs-control comparison and report held-out change as unmeasured, or explicitly revise baseline assessment and its tests before a new cohort starts.
- **acceptance:** The metric/protocol clearly distinguishes observed answers, inferred diagnostic mastery and missing control baselines. No missing baseline becomes a zero score or claimed improvement.
- **tests:** A diagnostic with no held-out answers yields null/unmeasured held-out change; observed and inferred baseline values are distinguishable; a synthetic measured baseline produces the expected change only if the chosen protocol collects it.
- **notes:** Logged without changing T-015’s existing held-out protection. The new learner page labels its output as cold recall scores, not retention gain.

### T-132 · The honest ask has no home now
- **status:** todo
- **sprint:** 5
- **depends_on:** T-131
- **files:** `frontend/src/features/landing/*`, `frontend/src/features/auth/*`, `frontend/src/features/onboarding/*`, tests alongside
- **description:** T-131 moved the public copy to `docs/copy.md` and took the recruitment framing off the public page — correctly. But **the app's landing page still carries it**, and the disclosures it carried are load-bearing: the unannounced test, the concepts deliberately never taught, the exact days asked for, and that the result gets written up. T-101 gave each of those an assertion on purpose, because a participant who feels tricked on day 30 drops out and a dropout costs a tenth of the result.
  - Two jobs, in order. **(a)** Bring `frontend/src/features/landing` in line with `docs/copy.md` — the same words, so the two surfaces cannot drift. **(b)** Re-home every disclosure into the sign-up and onboarding flow, where a person actually commits, and **move T-101's tests with them** rather than deleting them.
  - The consent copy is not the marketing copy with a warning bolted on. It is a short, plain screen that says what the next thirty days involve, shown before the diagnostic and after the account exists.
- **acceptance:** `docs/copy.md` and the landing page say the same thing. Every disclosure T-101 tested still has a test, now against the flow that shows it. No public surface contains anything on `copy.md`'s never-write list.
- **tests:** landing renders the copy.md blocks; the consent screen names the unannounced test, the untaught concepts, the number of days, and the write-up; a learner cannot reach the diagnostic without passing it; the never-write list has a grep test over the landing page.
- **notes:** (2026-09-10) One more line needs to change as part of (a), not just the pilot-framing removal above: T-149 shipped free-text topics in onboarding, and this page still says "your own topics aren't open yet. The pilot runs on three I've read every question in by hand" — no longer true. Left for this task rather than patched separately, so it doesn't fight with whatever `docs/copy.md`-alignment pass lands here.

### T-133 · The page promises a re-test the build does not run
- **status:** todo
- **sprint:** 5
- **depends_on:** T-131
- **files:** `docs/copy.md`, `backend/src/workers/*`, `backend/src/modules/tests/*`
- **description:** `docs/copy.md` flags one claim that runs ahead of the build, and it is on the public page: *"weeks after the teaching stops, Cold Recall asks again."* That describes the product. What exists is a topic moving to `holdout` and going deliberately silent for twenty-three days (T-104, T-105) so the first cohort can be measured once — same mechanism, different schedule, and **not** an automatic re-test every learner gets.
  - Either the scheduler grows a real post-holdout cold test that any learner receives, or the sentence comes off the page. It should not be the sentence: the claim is the product, and it is the name.
- **acceptance:** A learner who finishes a topic and goes quiet is served a cold test without anyone triggering it by hand, and `copy.md`'s flagged-claim note is deleted because it is no longer flagged.
- **tests:** a topic past its holdout window schedules a test for its learner; a topic still inside it does not; a learner already tested is not re-tested.

### T-141 · A signed-in learner can still see the sign-in form
- **status:** todo
- **sprint:** 6
- **depends_on:** —
- **files:** `frontend/src/app/router.tsx`, `frontend/src/features/auth/pages/LoginPage.tsx`
- **description:** Found while writing E2E-001 (`docs/e2e-tasks.md`). `/` forwards a signed-in visitor straight to `/home` (T-071), but `/signin` has no equivalent guard — a signed-in learner who navigates or is linked to `/signin` sees the full sign-in form again (Google/GitHub buttons, email field, dev sign-in), rather than being forwarded past it. Not a crash and not a security issue (OAuth/dev-login on an already-valid session just resolves to the same account), but it is the one route in the app that doesn't follow the pattern every other guard uses, and it reads as "did I get signed out?" to anyone who lands there by mistake — a bookmark, a back-button, a stale tab.
- **acceptance:** A signed-in visitor to `/signin` is forwarded to wherever `/` would have sent them (`/home` or `/onboarding`), the same way `/` already behaves.
- **tests:** signed-in `/signin` redirects away from the form; signed-out `/signin` is unaffected; the OAuth start/callback links on the form still work for a genuinely signed-out visitor (regression check — the fix must not accidentally guard the callback route too).
- **notes:** (2026-09-10) Confirmed via screenshot, not just a failing assertion — the form renders completely normally for a signed-in session; there's no error state, just the wrong screen. `e2e/web/signin.spec.ts`'s "a signed-in visitor to /signin is forwarded away from the form" test asserts today's actual (unguarded) behavior with a comment pointing here, so the suite stays honest until this is fixed rather than asserting a redirect that doesn't exist.

### T-150 · Two active topics: `/session` and the dashboard disagree on which one
- **status:** todo
- **sprint:** post-pilot
- **depends_on:** T-058
- **files:** `backend/src/modules/session/session.repository.ts`, `backend/src/modules/topics/topics.repository.ts`
- **description:** Found live while verifying T-149 (free-text topics) against a real generation. `findActiveTopic` (`session.repository.ts`) orders `asc(topics.createdAt)` — oldest first; `listTopics` (`topics.repository.ts`, what `topics[0]` throughout the frontend reads) orders `desc(topics.createdAt)` — newest first. With exactly one active topic this never shows; with two, `/session` teaches the *older* one while the dashboard, map header (T-142) and AppBar all talk about the *newer* one — a Frankenstein experience where the screens disagree about which course is even running.
  - **Deliberately not fixed here.** `createTopic`'s own comment is explicit: "Whether someone may hold two *active* topics is a product question (plan.md §8 puts multi-topic scheduling out of scope for the pilot), not this guard's business." `createTopic` only dedupes a `generating` duplicate — nothing stops a second `active` topic today, and per that comment nothing is supposed to. Picking ASC or DESC now would be guessing at a decision plan.md hasn't made yet.
  - **Newly reachable, not just a pre-existing edge case.** Before T-149, creating a second topic while one is already active required manually navigating to `/onboarding`'s URL while signed in with an active topic elsewhere — `LandingRoute` never offers that path. T-149's free text doesn't change that gate, but it does mean a learner who *does* reach onboarding a second time (a stale tab, a bookmark) can now name any topic rather than only the three pilot ones, so the resulting confusion is worse than "wrong pilot topic" would have been.
- **acceptance:** Whenever T-058 (multi-topic) or a deliberate decision on "can a learner hold two active topics" lands, `findActiveTopic` and `listTopics` agree on which topic is "current" — same ordering, one source of truth for both.
- **tests:** a user with two active topics sees the same topic named in `/session`, `/home`, `/map`, and the AppBar header.
- **notes:** (2026-09-10) Confirmed on the real dev account mid-session (a leftover seed topic plus a freshly-generated one, both `active`) — cleaned up by deleting the leftover rather than by changing this ordering, since the account only had two active topics because of test-data accumulation, not a real product flow.

## Sprint 6 — End-to-end integration tests (added 2026-09-10)

> **Why this sprint exists.** The three vitest suites (backend 407, frontend 49,
> extension 35) are green and none of them opens a browser. Everything they
> prove is a unit or a contract; nothing proves that the screens, the API and
> the shared design system work when wired together, or that the extension's
> 380px popup renders the same card the web app does — which is exactly the
> class of bug T-126 and T-130 were.
>
> **Playwright, against the real backend and a real Postgres.** Not mocks: a
> mocked integration test proves the mock. Every test records a video, a
> screenshot and a trace, because a founder reviewing a screen should be able
> to *watch* it rather than read an assertion.
>
> **What this sprint deliberately does not cover:** scheduler arithmetic,
> backoff timing, queue retry rules and generator prompts. All are covered by
> vitest, and re-testing them through a browser buys a slower suite that fails
> for uninteresting reasons. `extension/src/__tests__/flow.test.ts` (T-037)
> already does the simulated day properly.

### T-134 · The E2E harness
- **status:** todo
- **sprint:** 6
- **depends_on:** —
- **files:** `playwright.config.ts`, `e2e/global-setup.ts`, `e2e/api.ts`, `e2e/card.ts`, `e2e/extension/fixtures.ts`, `e2e/README.md`
- **description:** Playwright at the repo root (not a sixth workspace package — the specs need no dependencies of their own). Two projects: `web`, and `extension`, which must build its own persistent context because `--load-extension` is a profile-level flag and MV3 cannot load into a plain browser context. `workers: 1` and `fullyParallel: false`: there is one seeded learner with real scheduler state, so parallel tests would race over the same review queue.
- **acceptance:** `pnpm e2e` seeds a known dataset, starts (or reuses) the backend and frontend, runs both projects, and writes an HTML report carrying a video, screenshots and a trace for every test.
- **tests:** the harness is proved by the suites below running on it.

### T-135 · E2E — the learner's path through the web app
- **status:** todo
- **sprint:** 6
- **depends_on:** T-134
- **files:** `e2e/web/*.spec.ts`
- **description:** The screens a pilot participant actually walks through, in order, against real data.
- **tests:**
  - `/` signed out is the landing page and contains no email field; the call to action reaches `/signin` (T-101 regression).
  - Dev sign-in lands on the dashboard with a session to do (T-070, T-071).
  - A session teaches: try-first attempt → explanation → retrieval → server grading → Next.
  - **The session runs its due reviews** — the T-073 regression, and the one every suite passed while it was broken.
  - The map renders and never names a held-out concept (T-017; the control arm is what the result rests on).
  - The day-30 cold test opens, accepts answers and submits (T-112).
  - `/connect` mints an extension token on an explicit click (T-034).

### T-136 · E2E — the extension in a real browser
- **status:** todo
- **sprint:** 6
- **depends_on:** T-134
- **files:** `e2e/extension/*.spec.ts`
- **description:** Loads the unpacked build into Chromium and drives the popup and options page. Nothing else in the repo does this: `flow.test.ts` simulates a day against `fakeBrowser`, which cannot tell you the popup renders at all.
- **tests:**
  - A fresh profile's popup says "not connected" and offers the button that fixes it — not "nothing due", which would look like an extension that silently never pops.
  - The options page verifies a pasted token against `GET /me` **before** storing it, and shows the account.
  - A mis-pasted token is refused with an actionable message and nothing is stored.
  - The popup renders a due card and the answer reaches the server (T-129: opening the popup deliberately asks `/due` itself).
  - The daily mood tap appears once (T-032).
- **notes:** Headed, not headless — Chromium's headless mode cannot run MV3 extensions. On CI that needs `xvfb-run` (T-139).

### T-137 · E2E — card parity and cross-surface truth
- **status:** todo
- **sprint:** 6
- **depends_on:** T-135, T-136
- **files:** `e2e/card.ts`, `e2e/extension/popup.spec.ts`
- **description:** `QuestionCard` (`@learnos/ui`) is the single component behind the session, the diagnostic, the day-30 test and the extension popup, so the design cannot drift between them **by construction**. What can still drift is the CSS each surface loads around it — the popup is a 380px window on its own origin with its own stylesheet entry, and T-126 was precisely that bug.
- **tests:**
  - The popup's card and the session's card compute to the same font stack and the same box model. **Not a pixel diff**: a 380px popup should lay out differently; what must match is which design system drew it.
  - An answer given through the extension moves the web app's knowledge score.
  - The extension never shows an untaught or held-out concept (T-033, T-089).

### T-138 · E2E — every answer format renders and is answerable
- **status:** todo
- **sprint:** 6
- **depends_on:** T-134, T-140
- **files:** `e2e/web/formats.spec.ts`, `backend/src/scripts/seedFormats.ts`
- **description:** One test per answer surface: recognition, recall, explain, numeric, `clozeCode`, `hotspotLine`, `orderLines`, `codeEditor`. This is the suite that would have caught T-118 — `numeric` shipped half-built, a field nothing read.
- **tests:** each format renders its own surface (not the fallback text box), accepts an answer, and grades; `codeEditor` is absent from the extension (T-089) and from the day-30 test (T-093).
- **notes:** Blocked on T-140 until there is data to render — see below.

### T-139 · E2E in CI
- **status:** todo
- **sprint:** 6
- **depends_on:** T-135, T-136, T-137
- **files:** `.github/workflows/ci.yml`
- **description:** Run the suite on a real Postgres and Redis in Actions, under `xvfb-run` for the extension project, uploading the HTML report as an artifact. Deliberately after the suite is stable locally: a flaky E2E job teaches people to ignore CI, which costs more than it catches (the T-111 lesson).
- **tests:** the job passes twice in a row on an unchanged tree.

### T-140 · No generated item has ever carried a block
- **status:** todo
- **sprint:** 6
- **depends_on:** —
- **files:** `backend/src/scripts/seedFormats.ts`, `backend/fixtures/*`
- **description:** Found while planning T-138. The dev database holds **1,357 items across four types** — `application` 404, `recognition` 381, `explain` 314, `recall` 258 — and **zero with a `blocks` array**. So every Sprint 5 answer surface (`clozeCode`, `hotspotLine`, `orderLines`, `codeEditor`, `numeric`) is built, unit-tested, and **has never been rendered from real data by anything**.
  - **This is not yet evidence the generator is broken.** The seed reads `backend/fixtures`, which predate Sprint 5, so a fixture-seeded database could not contain blocks whatever the generator does. What it does mean is that nobody has confirmed the other direction either, and T-099 (reveal blocks are written and never seen) is the same smell from the other end.
  - Two things, and the order matters. **(a)** A dev script that inserts one item per block kind for the seeded topic, using the real `ItemPayloadSchema` so it cannot drift from what the worker writes — this unblocks T-138 without a $0.46, nine-minute generation per run. **(b)** Confirm against a **live** generation that the model actually emits blocks for a code topic, and if it does not, that is a generator defect and gets its own task.
- **acceptance:** `pnpm seed:formats` produces one answerable item per block kind; a live code-topic generation is inspected and the result recorded here either way.
- **tests:** every inserted item passes `ItemPayloadSchema`; `toPublicItem` strips the answer key from each; `/due` serves them.


### T-166 · The generator has never written a block, on any topic
- **status:** in_progress
- **sprint:** 6
- **depends_on:** —
- **files:** `backend/src/llm/prompts/items/domains/code.md`, `backend/src/generator/items.ts`, `backend/src/generator/conceptMap.ts`
- **description:** **Closes the open half of T-140.** That task found 1,357 items in the dev database and none with a `blocks` array, but could not say whether the generator was at fault: the seed reads fixtures that predate Sprint 5, so a fixture-seeded database could not have contained blocks whatever the generator does. It asked for a live code-topic generation to settle it.
  - **Settled, and it is the generator.** The 2026-09-12 run of *HashMap + prefix sums* (Python requested) produced **104 items across 16 concepts, of which zero carry a block.** Three concepts were classified `code`, so `domainFragment('code')` resolved and `items/domains/code.md` — the strongest prompt in the set, with its stop-at-first-yes decision list and four contrastive pairs — was appended to that batch's system prompt. The model read it and wrote eight plain items.
  - So `clozeCode`, `hotspotLine`, `orderLines`, `numeric` and `codeEditor` remain built, unit-tested, and **never once rendered from generated data**. T-138 (E2E for every answer format) is blocked behind this, and `T-099` (reveal blocks written and never seen) is the same smell from the other end.
  - **A likely contributing cause worth checking first: the map under-calls `code`.** The split for a topic about implementing a hashmap loop in Python came out prose 7 (44%), math 4, code 3, systems 2. T-082 deliberately classifies by the shape of a correct answer rather than by subject — which is right, and is why *"the question decides what the map stores"* is prose — but if `code` is under-called then most concepts never see the fragment that asks for blocks at all. Check the classification before rewriting the block instructions.
  - Second thing to check: the batch. `code.md` says "at most 2 of 6–8 items may use a rich format", written when a call covered one concept. A batch of four concepts now reads that as a budget across ~28 items with no per-concept anchor, the same failure mode T-164 found for the transfer count.
- **acceptance:** A live generation of a code topic produces at least one item per rich format across the course, or the reason it does not is written down here. `pnpm seed:formats` (T-140a) stays the route for E2E fixtures either way — this task is about the real pipeline.
- **tests:** a generation fixture asserting the code fragment is appended for a `code` batch (guards the wiring, not the model); the block-count expectation recorded here after a live run.
- **notes:** (2026-09-12) **Cause found, and it was neither of the two suspects above.** The batch JSON schema permits blocks — `blocksProperty` is on every item variant and `blocks` is in `required` — and the `code` fragment *was* appended to the code batch, which `promptContext.test.ts` already asserts. What was missing is that **`blocks` appeared nowhere in the generic contract**: `items/system.md` mentioned the word once, in a prohibition, and its Output template showed four item shapes with no `blocks` field at all; `items/example.md` mentions blocks zero times across nine worked items. The fragment was the only voice asking for them, appended last, against an example that had just shown nine items without one — and this repo already knows from T-082, T-106 and T-107 that **the example is the load-bearing part**.
  - Fixed by making the field visible and gating it on the fragment: every item in the Output template now carries `"blocks": null`, with a short section saying a domain section below may override it for the items it describes. The generic prompt is unchanged in what it *asks* for; the field simply exists now.
  - Also anchored `code.md`'s rich-format cap per concept rather than per reply — "at most 2 of them" was written when a call covered one concept, and a batch of four reads it as a budget across ~28 items. Same failure mode T-164 found for the transfer count.
  - **Live run done (2026-09-12, topic `b485fc8c`, 26 calls, $0.521). The prompt fix was necessary and is not sufficient: still 0 blocks in 100 items.** The measured reason is the suspect this task listed second — **the map under-calls `code`, and badly.** This run classified **1 of 16** concepts as `code` (the previous run managed 3): nine `prose`, five `math`, one `code`, one `systems`. The fragment that asks for blocks therefore reached a single batch containing a single concept, so no change to `items/system.md` could have moved the number much.
  - The classification is wrong on its own terms, not just inconvenient. T-082 says classify by the shape of a correct answer, and *"Look up before recording the current prefix"* came back `systems` while *"For counting, store frequencies"* and *"Remembering earlier prefix sums"* came back `prose` — on a Python topic where the correct answer to each is a line of code or a trace. **The next move is `conceptMap`'s domain instructions and its example, not the item prompts.**
  - Everything else in this task is built and covered; what remains is the classifier and then one more live run.
  - **Classifier fixed (2026-09-13).** The prompt was getting exactly what it asked for. `conceptMap/system.md` named a target — *"in a healthy code topic roughly **half** the concepts are `prose`"* — and a corrective in one direction only: re-check if *fewer than a third* are prose, with no matching check for too few `code`. Run 4 delivered 56% prose. And the only worked example of the decision is the sourdough map, which has **no `code` concept at all** — T-082 chose it deliberately to break the subject association, and it broke it thoroughly enough that a genuine code topic came back one-in-sixteen.
  - Replaced the ratio with "check it in both directions — do not aim at a ratio", and added a worked pass over a code topic using the **real misclassifications from run 4** as the contrastive cases: *"For counting, store frequencies"* and *"Remembering earlier prefix sums"* (filed `prose`, answer is a dictionary and what goes in it) and *"Look up before recording"* (filed `systems`, but the ordering is two statements in one loop body, not two components talking). It keeps the genuinely-prose and genuinely-math cases beside them so the pass is not a swing back. Same technique as T-106: the corrective is an example, not another rule sentence.
  - **Checked live in isolation** — framing and map only, two calls per topic rather than twenty-six:
    - *HashMap + prefix sums* (Python): **code 8 · math 4 · prose 2**, against code 1 before. Every concept named above as misclassified now comes back `code`; *"Negative values change the search"* correctly stays `prose`.
    - *Consistency in distributed systems* (no language), as the regression guard: **systems 11 · prose 5 · code 0.** The change did not pull a non-code topic toward `code`. It is systems-heavy, but that follows the pre-existing ordering-is-`systems` guidance rather than anything changed here — recorded, not acted on.
  - **Still open: one full live generation**, to confirm that code concepts reaching the fragment now actually produce rich-format items. The classifier was the blocker; whether the item side follows is the acceptance, and it has not been observed yet.
  - Do not "fix" the rest by loosening `MAX_RICH_ITEMS` or by adding blocks in post-processing. The cap is a review-time budget (T-083) and the blocks have to be the model's, resolved from line *quotes* by the worker — a generated block is the only kind the answer key can be trusted for.

### T-168 · One Coolify host on AWS, managed by Terraform
- **status:** in_progress
- **sprint:** 6
- **depends_on:** —
- **files:** `infra/bootstrap/`, `infra/modules/coolify-host/`, `infra/modules/dns/`, `infra/prod/`, `infra/README.md`
- **description:** Founder decision (2026-09-13): run everything — web app, API, worker, Postgres, Redis — on **one EC2 machine managed by Coolify** until there is a reason to split it, within a **$100 AWS credit**, with **Route 53** for DNS and **no blog yet**. Terraform owns the machine; Coolify owns what runs on it.
  - **Why now.** The deployed backend cannot generate at all: Upstash, its Redis, is over its request quota (500,004 / 500,000). The API itself is up — `https://api.coldrecall.info/health` returns 200 on a valid certificate — but on a t3.micro (1 GiB), which cannot run Coolify, whose minimum is 2 GiB.
  - **Machine: t4g.large** (2 vCPU / 8 GiB, arm64), ~$33/month on-demand in ap-south-1 and ~$42 all-in with the public IPv4, a 40 GB gp3 disk, backups and the zone — about 2.4 months of the credit. Chosen over t4g.medium (~$25) for headroom with the frontend on the box too.
  - **No SSH.** Ports 80 and 443 only; shell access and the Coolify dashboard tunnel go through SSM Session Manager. The legacy stack generated an SSH private key into the repo directory.
  - **Backups off the box**, because the box is the single point of failure: an S3 bucket for Coolify's scheduled database backups (versioned, encrypted, 30-day expiry) and daily EBS snapshots kept 7 days.
  - **Spend alerts measure gross spend.** AWS Budgets subtracts credits by default, so while the $100 is being used up, net spend reads $0 and no alert fires. `include_credit = false`.
  - **Cutover without downtime.** A `cutover` variable (default `false`) makes the new zone mirror what BigRock serves today — site on Vercel (`76.76.21.21`), `api` on the legacy EC2, email unchanged — so moving the nameservers changes nothing a visitor sees. Flipping it to `true` points the site and `api` at the host in one reviewed apply. Records are keyed by name, not type, because `api` changes from CNAME to A and Route 53 refuses both at one name.
  - **Email records copied verbatim**: Google Workspace MX, SPF, site verification and DKIM, and Mailgun's `k1` DKIM, which signs the app's magic-link emails. Adding Mailgun to SPF and publishing DMARC are **deferred at the founder's request** — a separate change from moving the zone, so if email misbehaves after the move there is one cause to look at.
- **acceptance:** `terraform plan` for `bootstrap` and `prod` is reviewed and approved by the founder before any `apply`. The host runs Coolify with the full stack deployed; a database backup has been **restored** into a scratch database; `coldrecall.info`, `www` and `api` resolve to the host over valid HTTPS; email still arrives; the legacy stack and the Vercel project are retired.
- **tests:** `terraform fmt -check` and `terraform validate` pass for every stack; the prod plan with `cutover = true` changes exactly `apex`, `www` and `api`.
- **notes:** (2026-09-13) **Applied**, after the founder reviewed both plans. Each apply ran from a saved plan and was gated on matching the reviewed counts exactly — bootstrap 4/0/0, prod 26/0/0 — so nothing outside what was read could be created.
  - **Live:** instance `i-0b2c0c0c89d40b0ee` (t4g.large, arm64, Ubuntu 24.04), Elastic IP `13.204.7.173`; state bucket `learnos-tfstate-719312763365`; backups `learnos-backups-719312763365`; hosted zone `Z03726822IYSE191YYZ40`. Both EC2 status checks ok; SSM agent Online. Coolify **4.3.19** installed on first boot in 131s, its six containers up, 2 GiB swap active.
  - **Zone verified before any nameserver change**, by asking Route 53 directly (`test-dns-answer`): apex and `www` answer `76.76.21.21`, `api` the legacy CNAME, `coolify` the new IP, and MX, SPF, site verification and both DKIM keys match BigRock. Google's 408-character key is stored as two strings of 255 and 153 that rejoin exactly. Switching the nameservers is therefore safe.
  - **Next, founder:** install the Session Manager plugin (`brew install --cask session-manager-plugin`); open the dashboard tunnel and **create the Coolify admin straight away**; move BigRock's nameservers to the four `awsdns` servers in `terraform output name_servers`. Then deploy Postgres, Redis, the backend and the frontend in Coolify, restore-test a backup, and flip `cutover`.
  - The bootstrap stack's state exists only on the machine that applied it (`infra/bootstrap/terraform.tfstate`, gitignored). Small and rarely needed — the bucket is `prevent_destroy` — but worth a copy somewhere safe.
  - Previously: written and validated; nothing applied. Waiting on the founder to create an IAM user or role for Terraform — `js-ai-lab-cli` can read EC2 but cannot manage IAM, Route 53, Budgets or DLM, and cannot call the Pricing API either (prices came from ec2.shop).
  - **Account: `719312763365`** (founder decision, 2026-09-13) — it holds the $100 credit. The legacy api and t3.micro live in `353400076760`, reached by the `js-ai-lab-cli` profile; retiring them after cutover uses that account's credentials. Both stacks set `allowed_account_ids` so a shell on the wrong profile cannot plan or apply into the wrong account.
  - **Open:** whether Coolify's S3 backup destination can use the instance role or insists on an access key. If the latter, create an IAM user whose only permission is the backup bucket.
  - The legacy stack (`infra/*.tf` at the folder root, local state) stays running until 48 quiet hours after cutover, as the rollback.
  - **`docs/aws-activate.md` is stale against this**: it describes ECS Fargate, RDS and ElastiCache, 20–40 concepts and 73 model calls per topic. Update it before submitting the Activate application.
  - Not in this task: CI deploys via GitHub Actions with OIDC, and secrets in SSM Parameter Store. Coolify deploys from GitHub itself and holds app environment variables, which covers both for one machine.
