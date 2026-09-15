# dryrun.md — the founder's five-day dry run (T-044)

> Before ten real people spend thirty days on Cold Recall, one person uses it
> exactly as they will, on production, and writes down everything that gets in
> the way. Every friction point becomes a `T-FIX-xxx` task with a severity, and
> **every `high` is fixed before the pilot starts** (T-045 comes after this).

## The rules

1. **Be a learner, not the builder.** Use `https://coldrecall.info` and the
   published extension — not localhost, not the dev sign-in, not the admin page
   to "just check". A pilot learner has none of those.
2. **Do not fix anything during the five days.** Log it and keep going. A fix
   mid-run changes the thing being measured, and you lose the second sighting
   that tells you whether it was a one-off.
3. **Log the moment it happens**, in the table at the bottom. "Something felt
   off on day 2" is not actionable on day 6.
4. **Pick a code topic.** It is the only way to meet `clozeCode`, `hotspotLine`,
   `orderLines` and `codeEditor` — the formats that changed most recently
   (T-170, T-171) and have had the least real use.
5. **Time things.** The product's promises are numbers: a 10–15 minute day, a
   twenty-second card. Note the real ones.

## Severity

| Severity | Means | Example |
| --- | --- | --- |
| **high** | A pilot learner would quit, lose work, or the measurement would be wrong | An answer marked wrong that was right; a card that never opens; a session that cannot finish |
| **medium** | Works, but a learner would be confused or annoyed often enough to notice | A screen that does not say what to do next; a daily session that runs 25 minutes |
| **low** | Cosmetic, or rare and harmless | Misaligned text; a slow but correct screen |

When unsure between two, pick the higher one. A `high` that turns out to be
`medium` costs a conversation; the reverse costs a participant.

---

## Day 0 — set up (about 30 minutes)

### Account and topic
- [ ] Open `https://coldrecall.info` signed out. Is it clear what this is and what you are signing up for?
- [ ] Sign in (Google, GitHub or email magic link). Did the email arrive, and how long did it take?
- [ ] Onboarding: name, timezone, **active windows** (the hours cards may interrupt you), topic, why, timeline, daily budget. Note anything you had to guess at.
- [ ] Pick a **code topic**. Time the wait screen until the topic is ready.
- [ ] The diagnostic (~15 questions, each with a confidence tap). Note any question that was ambiguous, wrong, or impossible to answer without context.
- [ ] The map (`/map`): green, yellow and grey concepts. Does the colouring match what you actually know?

### Extension
- [ ] Install the extension and pin its icon.
- [ ] In the web app, open **Connect extension** (`/connect`) and create a token.
- [ ] Paste it into the extension's options page (**Extension token** → **Connect**). It should say **Connected as** your email.
- [ ] Click the toolbar icon: the **side panel** opens (not a popup) and stays open while you click elsewhere.

---

## Days 1–5 — every day

### Web session (`/home` → `/session`)
- [ ] Note the start time. Is it obvious from `/home` what to do today?
- [ ] **New concepts.** Some open with **Have a go first** (try first), others with the explanation straight away (example first). Try "I don't know" at least once — does the explanation still make sense?
- [ ] **Reviews from earlier days.** For each, press **Check** and watch for **Checking…** while it grades.
- [ ] If a **`codeEditor`** comes up as a review, time it. In anything other than JavaScript, the verdict comes from the model — **record any verdict you think is wrong, with your code** (see the grading log below).
- [ ] If Check ever shows **"That didn't reach us"**, log it as `high` with the time.
- [ ] Note the end time. Was the session within your daily budget? By how much over or under?
- [ ] `/map`: did the score move, and does the direction feel right?

### Extension (during your active windows)
- [ ] A notification **"One question"** appears. Click it: the side panel opens on the card.
- [ ] Answer it. Note the time it took against the twenty-second promise.
- [ ] Rate confidence after the answer.
- [ ] The **mood tap** ("How’s the week going") appears once, after your first answered card of the day — and not again that day.
- [ ] Note every format you met in the panel today: recognition, recall, explain, numeric, `clozeCode`, `hotspotLine`, `orderLines`, `codeEditor`.
- [ ] For a `codeEditor` in the panel: does **Run the cases** (JavaScript) or **Submit** (other languages) work? Does **Show me the shape** make sense, and did you understand it counts against you?
- [ ] Anything that felt like it should not have been asked outside a session (too long, too hard to read in a narrow panel) — log it with the format.

### End of each day
- [ ] Total minutes: web session + extension.
- [ ] How many `codeEditor` reviews you got, and the minutes they took (nothing caps these yet — T-172).
- [ ] One sentence: would you open it again tomorrow if you were not the founder?

---

## One-off checks (spread across the five days)

- [ ] **Day 2 — Later.** Press **Later** on a card. It should come back after about thirty minutes, not immediately and not never.
- [ ] **Day 3 — the backoff.** Dismiss (✕) three cards in a row. The panel should say it will leave you alone until tomorrow, and it should keep that promise.
- [ ] **Day 3 — report.** Use **Report a bad question** on one card, after answering it.
- [ ] **Day 4 — offline.** Turn off wifi, answer a card: it should say **Saved. You're offline**. Turn wifi back on; the answer should arrive (the knowledge score or the next card reflects it).
- [ ] **Day 4 — a closed panel.** Open a card and close the panel without answering. Does the card come back later?
- [ ] **Day 5 — outside your active windows.** No notification should appear. Clicking the icon deliberately should still offer a due card.
- [ ] **Any day — sign out and back in.** Does the extension stay connected? Does the web app land you in the right place (T-141 is a known issue on `/signin`)?

## Not covered by five days

The Day-30 cold test only opens after the seven teaching days and the
twenty-three silent ones, so this run cannot reach it naturally. It has its own
e2e coverage task (E2E-009). Note it here as not exercised, rather than
assuming it works.

---

## Grading log — `codeEditor` verdicts

Only for answers in a language other than JavaScript (judged by the model).
One row per answer you doubt, **and** one row for at least three you agree with,
so a pattern is visible either way.

| Day | Concept | Language | Your code (paste or link) | Verdict shown | Right? | Note |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |

## Annoyance log

One row per friction point, written when it happens. At the end, each row gets
a `T-FIX-xxx` id in `docs/tasks.md` with the same severity.

| Day | Time | Surface (web / panel / email) | What happened | What you expected | Severity | Task |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |

## Daily numbers

| Day | Web session (min) | Budget (min) | Extension cards answered | Extension (min) | `codeEditor` reviews (count / min) | Dismissals | Would open tomorrow? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | | | | | | | |
| 2 | | | | | | | |
| 3 | | | | | | | |
| 4 | | | | | | | |
| 5 | | | | | | | |

## After day 5

1. Give every annoyance-log row a `T-FIX-xxx` task in `docs/tasks.md`, with its severity and the row's words as the description.
2. Fix every `high` before the pilot. Re-run the day it came from to confirm.
3. Copy the daily numbers into T-044's notes — the minutes per day and the `codeEditor` count are the evidence T-172's cap is waiting for.
4. Then T-045: generate and QA the two pilot topics.
