# ux-audit.md — findings from the E2E-015 walkthrough

> Produced 2026-09-10 from `backend/src/scripts/seedMatrix.ts` (9 users, 11
> topics spanning every `topics.status` plus two deliberately-unreachable
> extra topics) and `e2e/audit/walkthrough.spec.ts` (screenshots + visible
> text, no pass/fail assertions beyond "no uncaught client error"). Every
> screenshot referenced below lives under `e2e/.artifacts/audit/<user>/`.
>
> This is a qualitative read, not a test report. Four real product findings
> came out of it; each has its own task in `tasks.md`. Everything not called
> out below rendered clearly and did its job — the diagnostic screen, the
> map's legend and grid, the day-30 test's intro and question screen, and the
> results page were all clean, well-worded, and did not need a note.

## Findings, most severe first

### 1. A failed generation looks exactly like a healthy topic (T-142)

`matrix-09` (`topics.status = 'failed'`) lands on the ordinary dashboard —
same "Start today's session" button, same "Connect extension" prompt, nothing
anywhere saying the topic never finished generating. `DashboardPage.tsx`
branches on `topic.status` for exactly two values, `'testing'` and `'done'`;
everything else, including `'failed'`, falls through to the default view.
Clicking "Start today's session" would call `GET /session`, which throws
`no_active_topic` for any non-`'active'` topic and comes back as a 404 —
and `SessionPage.tsx` has no error handling for that response at all, so the
learner would land on whatever the loading/undefined-data state renders,
with nothing telling them what went wrong or what to do next.

**Screenshots:** `matrix-09/02-dashboard.png`.

### 2. The quiet period looks exactly like an active course (same root cause)

`matrix-06` (`status = 'holdout'`, day 8–29, the twenty-three days of
deliberate silence) shows the identical dashboard: "Start today's session",
"Connect extension isn't connected yet." Nothing says *why nothing should be
happening right now* — which is the opposite of plan.md's own design intent
for this period ("the extension goes silent for the twenty-three days...
Nothing is broken. The silence is the experiment," per `docs/extension.md`'s
participant copy). The web dashboard doesn't carry that message at all; only
the extension's install doc does. A participant who opens the web app during
the quiet period and sees an ordinary "Start today's session" button has
every reason to click it, and from there hits the same unhandled 404 as
finding #1.

**Screenshots:** `matrix-06/02-dashboard.png`.

### 3. Viewing a different topic shows the wrong name in the header

`AppBar.tsx` reads `topics.topics[0]` unconditionally for its title
breadcrumb, regardless of which topic's page is actually open. Confirmed by
diffing `matrix-04`'s own map (`03-map.png`) against the same user's *other*
topic's map, reached directly at `/map/<other-topic-id>` (`06-extra-map.png`):
both show "REACT HOOKS — MID-COURSE" in the header, but the **body** of the
second one correctly shows the other topic's own numbers (3 taught, not 5;
different scores). So the page fetches the right topic's data — only the
title bar is wrong. Today this is invisible because the pilot runs one topic
per learner; it stops being invisible the moment T-058 (multi-topic) opens
up, and `/map/:topicId` / `/results/:topicId` already accept a topic that
isn't `topics[0]` today, so the wrong header is reachable right now, not just
after T-058 ships.

**Screenshots:** `matrix-04/03-map.png` vs `matrix-04/06-extra-map.png`
(`.txt` files diff cleanly on everything except the two numbers and the
title, which should have differed and didn't).

### 4. A generating topic's wait screen doesn't survive a lost `localStorage` (T-144, lower priority)

`matrix-01` (`status = 'generating'`) is correctly routed to `/onboarding`
by `LandingRoute`, but `OnboardingPage.tsx` shows step 1 of a brand-new
five-step form ("Who's learning?") instead of the "we're building your map"
wait screen. Traced this to `OnboardingPage` keying its wait-screen logic
entirely off `draft.topicId` in a **client-persisted** (`localStorage`)
Redux slice, never off the server's own knowledge that a topic exists and is
generating. In the ordinary case — same browser tab or a reload — this works
fine, because the draft survives in `localStorage`. It fails specifically for
a learner who submits step 5 on one device or browser profile and later opens
the app from a different one (or has cleared site data): the server correctly
routes them to `/onboarding`, and onboarding has no way to know a topic is
already running, so it asks all five questions again. **Filed as lower
priority** because it needs a specific, less-common circumstance to trigger,
and the realistic fix (have `OnboardingPage` check `GET /topics` for an
existing non-failed, non-active topic before defaulting to step 1) is small.

**Screenshots:** `matrix-01/01-entry.png` (step 1) against the "BUILDING YOUR
MAP" text already present in the same page's own header bar — the
inconsistency is visible within one screenshot.

## Things that worked, worth naming so they don't get "fixed" by accident

- **The day-30 test's intro screen** ("Your recall check is ready — allow up
  to 20 minutes, answer from memory") and the question screen itself
  (progress count, confidence gate, "each submitted answer is saved, resume
  later") are clear and match plan.md's own design intent precisely.
  `matrix-07/02-dashboard.png`, `matrix-07/05-test-screen.png`.
- **The results page** is the strongest screen in the product: a plain
  headline number, an honest one-line explanation of why the held-out
  comparison is the real number, and three cleanly separated lists (what
  stuck / what didn't / what was never taught). `matrix-08/04-results.png`.
- **The map's held-out treatment** never leaks a title, consistently, across
  every state tested — the placeholder text and the `?` affordance are the
  same everywhere. No privacy-boundary finding survived this audit; T-013's
  design holds up under a real walkthrough of five different topic states.
- **The diagnostic screen** (`matrix-02,03/04-diagnostic.png`) is calibrated
  exactly as plan.md describes: the confidence gate, the "getting these wrong
  costs you nothing" framing, and the plain single-line input all read as
  intended.

## Known gaps in this audit's own coverage

Said plainly, so nobody mistakes silence here for a clean bill of health:

- **The "nothing due today" empty state was never actually captured.**
  `matrix-05` ("caught up") still shows "1 new" on its dashboard, because the
  seed marks only 5 of ~20 teachable concepts as taught — there is always a
  new concept left to teach until all of them are. Reaching the genuine
  empty state needs every teachable concept taught, which `seedMatrix.ts`
  doesn't currently do.
- **The diagnostic's own "in progress" vs "not started" states are not
  actually distinguished** in this seed — both `diagnosticStarted: true` and
  `false` produce the same `{estimates: {}, asked: []}` shape server-side (or
  `null`), which happen to render identically. A genuinely partial diagnostic
  (some concepts answered, some not) was not exercised.
- **The real post-signup routing (topic creation → diagnostic) was bypassed.**
  This audit signs in via an injected session cookie and seeds topics
  directly in Postgres, skipping whatever client-side navigation the real
  onboarding flow performs right after `POST /topics` succeeds. Whether a
  brand-new learner is actively routed into the diagnostic immediately after
  onboarding (rather than just being able to reach it) was not tested here —
  that belongs to E2E-002/E2E-003 in `docs/e2e-tasks.md`.
- **Clicking through from the broken dashboards (findings #1, #2) into the
  actual 404 was not captured** — the write-up above reasons about it from
  the source (`session.controller.ts`'s 404 mapping, `SessionPage.tsx`'s lack
  of an error branch) rather than a screenshot of the resulting screen. Worth
  a follow-up screenshot once T-143 is scoped.
