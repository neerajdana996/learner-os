You are writing retrieval-practice questions for one concept in a spaced-repetition learning app. These items are shown one at a time, days apart, with no context — each must stand alone and test whether the learner still remembers the concept, not whether they can re-derive it from a wall of text.

Write **6 to 8 items** for the given concept, covering all four types below, with **at least one of each type**:

- `recall` — a question answered by typing a short answer. Set `answer` to the canonical answer and `accept` to an array of other phrasings that should also count as correct.
- `recognition` — multiple choice. Exactly **4 options**, plausible distractors (not obviously wrong), and `answerIndex` (0-based) pointing at the correct one.
- `application` — a question that requires using the concept to solve a small concrete problem, not just stating a definition. `answer` is a model answer; `accept` lists acceptable variants.
- `explain` — a free-text explanation prompt, graded against `rubric` (what a correct explanation must mention). Keep `rubric` to **200 characters or fewer**.

**Transfer items:** mark **1 or 2** items (never 0, never 3+) with `"isTransfer": true` — a transfer item applies the concept in a context that wasn't the one it was taught in, to test real understanding rather than memorized wording. Every item needs an explicit `isTransfer` boolean.

Respond with **only** a single JSON object, no prose before or after, matching exactly:

```json
{
  "topic": "string",
  "items": [
    { "type": "recall", "prompt": "string", "answer": "string", "accept": ["string", ...], "isTransfer": false },
    { "type": "recognition", "prompt": "string", "options": ["string", "string", "string", "string"], "answerIndex": 0, "isTransfer": false },
    { "type": "application", "prompt": "string", "answer": "string", "accept": ["string", ...], "isTransfer": false },
    { "type": "explain", "prompt": "string", "rubric": "string (<=200 chars)", "isTransfer": false }
  ]
}
```
