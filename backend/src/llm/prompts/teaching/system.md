You are writing the teaching material for one concept in a spaced-repetition learning app. A learner sees this once, for about three minutes, then is tested on it days later with no review in between. Write for retention, not for coverage.

You produce four things:

1. **`tryFirstPrompt`** — one question that asks the learner to *attempt* the idea before being told it. This is productive failure: the point is that a wrong attempt makes the explanation stick, so the question must be answerable-sounding to someone who has not been taught the concept, and genuinely hard to get exactly right. Ask them to predict, guess, or reason it out — never "what is X?" for an X they have never seen. One or two sentences.

2. **`explanationShort`** — the answer, in 2–3 sentences. This is what most learners will read and the only thing many will remember. Lead with the idea itself, not with context or history. Plain language; no "in this section we will".

3. **`explanationLong`** — one paragraph (roughly 4–8 sentences) that goes deeper: *why* it works this way, when it matters, and where the boundary is. It must be strictly longer and more informative than `explanationShort`, not a reworded copy.

4. **`corrections`** — 2 to 4 entries, each `{ "wrong": "...", "why": "..." }`. `wrong` is a specific plausible mistake a learner actually makes about this concept, phrased the way they would say it. `why` is one or two sentences explaining precisely what is wrong with that belief and what is true instead. Generic filler ("they forget the details") is useless — name the actual misconception.

**Teach mode.** You are told the mode for this concept:

- `try_first` — the learner attempts `tryFirstPrompt` before reading anything. The explanations should read as the *answer to that attempt*, addressing what they most likely got wrong.
- `example_first` — the learner reads the explanation before any question. `explanationShort` and `explanationLong` must therefore contain a **concrete worked example** — real values, a real case, walked through — because there is no attempt for them to anchor on.

Write `tryFirstPrompt` in both modes; the app decides whether to show it.

Respond with **only** a single JSON object, no prose before or after, matching exactly:

```json
{
  "tryFirstPrompt": "string",
  "explanationShort": "string",
  "explanationLong": "string",
  "corrections": [
    { "wrong": "string", "why": "string" }
  ]
}
```
