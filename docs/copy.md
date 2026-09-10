# copy.md — the public words

> **This file is the source of truth for every public-facing word.** Two
> surfaces render it: the static site at `coldrecall.info` (`site/index.html`)
> and the app's own landing page (`frontend/src/features/landing`). Change the
> copy here first, then bring both into line. Neither surface is the master.
>
> Written 2026-09-10, replacing the recruitment copy the app's landing page
> shipped with in T-101.

---

## 1. The rule that produced this file

The landing page was written to **recruit ten pilot participants**. It opened on
"ten people, one topic each", promised "a test you won't see coming", disclosed
that "about one concept in ten is held back", and admitted "I don't know yet
whether this works". Every one of those sentences is true and every one of them
is *internal*.

**Marketing copy is read by a stranger deciding whether they want this. Consent
copy is read by someone about to commit to being measured.** They are different
documents with different jobs, and collapsing them casts the reader as a subject
in someone's experiment rather than a person who might buy something.

So:

| Belongs on a public page | Belongs in sign-up / onboarding |
| --- | --- |
| What the product does, and for whom | How many days of their attention we want |
| Why it works — the mechanisms, named | That the final test is unannounced |
| The cold test as a **feature**: you find out what stuck | That ~1 concept in 10 is deliberately untaught |
| What is opinionated about it | That the result is written up and shared |
| What it costs and what happens to their data | Which topics they may pick from, and why only those |

The right-hand column is not softened or dropped — it moves to the flow where a
person actually commits, and it keeps its tests (T-101 made those assertions
load-bearing on purpose). See T-132.

### Never write, on a public surface

- "ten people", "ten places", "the pilot", "participants", "the first run"
- "I don't know yet whether this works", "it might show it didn't"
- "a test you won't see coming", "surprise test", "unannounced"
- "we hold some of it back", "never taught, never reviewed"
- "the number gets published"
- Any first-person singular. The product is not one person's diary.

### Voice

Second person. Present tense. Name the mechanism instead of reaching for an
adjective — "twenty seconds, in hours you choose" beats "seamless and
respectful". No "revolutionary", "AI-powered", "supercharge", "unlock",
"game-changing", "effortless". Sentences short enough to read on a phone at
speed. Never a claim the built product cannot keep today.

---

## 2. Positioning

**Category.** A retention tool for technical learning — the thing that runs
*after* the tutorial.

**One sentence.** Cold Recall turns a technical topic into a map of what you
actually don't know, teaches only that, and then keeps it from slipping.

**Who it is for.** Someone who learns technical material on their own —
engineers, people changing track, people preparing for interviews — and who has
noticed that finishing a course and knowing the material are different events.

**The problem, in their words.** *"I understood it when I read it. Three weeks
later I couldn't have explained it to anyone."*

**Why it is different from the four things they have already tried:**

| They have tried | Why it didn't hold | What this does instead |
| --- | --- | --- |
| A course or a video series | Measures what you clicked through | Measures what you can still produce |
| Flashcards (Anki and friends) | You have to build and maintain the deck | The deck is generated from the topic, and scheduled for you |
| Asking a chatbot | Explains beautifully, asks you nothing | Asks first, explains second, comes back later |
| Notes and re-reading | Recognition, not recall | Retrieval only — nothing on screen to recognise |

**The name.** A *cold* recall is one with no warm-up: no revision, no re-read,
no cue. It is the only kind that proves anything, and it is what the product is
built to produce.

---

## 3. The page, block by block

Section order is deliberate: promise → the problem they recognise → the
mechanism → what is opinionated → what is in it → the proof → the ask.

### Nav
- Wordmark: **Cold Recall**
- Links: How it works · Why it works · What you get
- Button: **Get early access**

### Hero

- Eyebrow: `EARLY ACCESS · OPENING SOON`
- **H1: Learn it once. *Still know it* a month later.**
- Lede: You understood it in the video. By Friday it was gone. Cold Recall maps
  your topic, works out what you actually don't know, teaches only that — then
  keeps asking, twenty seconds at a time, until it's yours.
- Buttons: **Get early access** · See how it works
- Evidence line: Built on the four interventions with the largest measured
  effect on long-term retention, in that order — **retrieval practice**,
  **spacing**, **immediate feedback**, **mastery gating**. Not on streaks.
- Beside it: a real question card, answerable at a glance, showing the line the
  product turns on — *"9 days since you last saw this."*

### The problem

**H2: Almost everything you learn this month will be gone by the next.**

Three columns, no headings longer than three words:

1. **Understood → gone.** Comprehension while you read is not memory. It feels
   like learning, which is exactly why nobody notices the difference until they
   need the thing.
2. **Re-reading.** The most common study method is also among the weakest.
   Recognising a page you have seen before is not the same skill as producing
   the answer without it.
3. **Completion.** Courses measure what you clicked through. A progress bar at
   100% and a head that is empty in three weeks are entirely compatible, and
   both are common.

### How it works

**H2: Four things, and none of them is a video.**

Lede: A course hands you everything and hopes. This does the opposite: it works
out what you're missing, teaches only that, and spends the rest of its effort
making sure it stays.

1. **It finds out what you already know.** About fifteen adaptive questions
   before any teaching — harder after a correct answer, back to the prerequisite
   after a wrong one. Prior knowledge is the biggest single predictor of what
   sticks, so your map starts part-coloured and what you already have is
   skipped.
2. **You try before you're told.** Every new concept opens with an attempt you
   will probably get wrong. Failing first and then seeing the explanation beats
   reading the explanation cold — and it is the part most tools skip, because it
   feels bad.
3. **Then it comes and finds you.** A Chrome extension asks one question,
   wherever you already are, at the moment you're about to forget it. Twenty
   seconds, only in hours you choose, and it stops for the day if you wave three
   away.
4. **You can see what is slipping.** Your map is coloured by predicted recall,
   not by what you've clicked through. Amber means it's going this week, and the
   next session goes straight there.

### Why it works

**H2: Five decisions that make it less pleasant to use.**

Lede: Every one of them costs us something in the first five minutes. They are
also the reason you still know this in a month, so none of them is coming out.

1. **A score you cannot farm** — `≥ 1 day`. Your knowledge score moves only when
   you recall something correctly at least a day after you last saw it, and it
   decays on its own as forgetting is predicted. Showing up earns nothing,
   because showing up is not what is being measured.
2. **You fail before you are taught** — `Try first`. Every new concept opens with
   an attempt you will probably get wrong. Struggling before being shown the
   answer produces better understanding than being shown it first — even though
   it feels considerably worse at the time.
3. **No "how do you learn best?"** — Matching teaching to "visual" or "auditory"
   learners has failed every controlled test it has been given. You will never
   be asked. What you actually remember is the only signal used.
4. **Three new ideas a day, maximum** — However far behind you are, a session
   never puts more than three new concepts in front of you. The cap is enforced
   rather than suggested, because a session you bail out of teaches nothing.
5. **No streaks. No badges. No coupons.** — Extrinsic rewards reliably undermine
   the motivation they are meant to create. There is nothing here to collect.
   Miss a day and nothing breaks; the only thing keeping you here is whether
   it's working.

### What you get

**H2: What's actually in it.**

Lede: Not a roadmap. Everything below is built.

- **A concept map, generated from your topic.** Twenty to forty concepts with
  real prerequisite edges, each one classified by the shape of a correct answer
  rather than by subject — which is what decides the kind of question you get.
- **An adaptive diagnostic.** Roughly fifteen questions, each chosen from your
  last answer, with a confidence tap. It stops when your map is resolved rather
  than at a fixed count.
- **A scheduler that predicts forgetting.** Per concept, per person. Every
  answer is recorded with what the model believed *before* the question was
  shown, so its calibration is checked rather than assumed.
- **Questions that fit the material.** Fill in the blank, click the line that is
  wrong, put the lines in order, write the code, or answer in your own words —
  graded on meaning, not on string equality.
- **A Chrome extension that takes no for an answer.** One question at a time,
  inside windows you set, under a daily cap, never while you're away from the
  keyboard, silent for the day after three refusals. Answers given offline are
  queued and sent when you're back.
- **Not a chatbot.** There is no box to chat into. The model's work happens
  before you arrive — building the map, writing the questions, marking your
  answer. What you get is the question.

### The proof

**H2: Then it asks you cold.**

Lede: Weeks after the teaching stops — no revision, no warm-up, no cue — Cold
Recall asks again. That is the only test that proves anything, and it is the one
this is named after.

Three points:

- **A number, not a feeling.** You find out what you still know, per concept,
  against what you knew the day you learned it. "I think that stuck" is not a
  result.
- **Nothing to warm up on.** Recall with a cue is recognition wearing a hat. The
  gap is the measurement, so the gap is left alone.
- **Wrong is useful.** Whatever slipped goes back into the schedule at the front
  of the queue. The test is not a grade; it is the most informative input the
  scheduler ever gets.

### The ask

- Eyebrow: `EARLY ACCESS`
- **H2: Tell us what you want to learn.**
- Lede: Cold Recall is opening on a small set of technical topics, every question
  in them reviewed by hand. Tell us which one you'd start with and we'll come
  back to you when it's ready — starting with the topics the most people ask
  for.
- Buttons: **Ask for access** · Ask a question
- Under it: No cost, no card. One email when your topic opens, and nothing else.

### Footer
- Wordmark, then: Spaced retrieval practice, with the outcome measured rather
  than assumed.
- Links: How it works · Why it works · What you get · Contact

---

## 4. Claims, and what backs them

Anything on this list that stops being true has to come off the page the same
day.

| Claim | Basis |
| --- | --- |
| "the four interventions with the largest measured effect" | plan.md §3.2 — retrieval practice, spacing, feedback, mastery gating, in that order |
| "twenty to forty concepts with real prerequisite edges" | The concept-map generator; measured at 40 concepts / ~256 items on a live topic (T-074) |
| "predicts forgetting" | FSRS state per user × concept; `predicted_recall` written before every question (plan.md §6) |
| "graded on meaning, not string equality" | T-FIX-005 |
| "one question at a time, windows, cap, three refusals" | T-028, T-030 — enforced in `lib/schedule.ts`, not aspirational |
| "answers given offline are queued" | T-031 |
| "not a chatbot" | Structurally true: no client ever calls the model (loop.md §2) |
| "every question reviewed by hand" | The QA checklist, run per topic before anyone is onboarded (T-024, T-045) |

**One claim runs ahead of the build and is flagged here on purpose:** "weeks
after the teaching stops … Cold Recall asks again" describes the product. Today
a topic goes to `holdout` and the extension goes deliberately silent for
twenty-three days (T-105), because that silence is how the first cohort is
measured. Same mechanism, different schedule — but the page must not imply the
current build re-tests every learner automatically. Reconciling the two is
T-133.
