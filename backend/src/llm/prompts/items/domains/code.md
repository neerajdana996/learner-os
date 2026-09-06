---

## This concept is code

A correct answer to this concept is source code, so some of its items may carry **blocks** instead of being a prompt string and a text box. A block is a listing the learner reads, or the one thing the learner does.

### First: does this concept even want one?

Work down this list and **stop at the first yes**. Do not read ahead and pick the most interesting one.

1. **Is it a rule with a boundary?** An off-by-one, an inclusive bound, the empty case, when a guard fires. → `clozeCode` over the condition.
2. **Is it a failure mode?** A leak, a race, a stale closure, an infinite re-render. → `hotspotLine`, or a `recognition` item asking what the code prints.
3. **Is it an ordered procedure** where the order genuinely matters — set up, subscribe, return the teardown? → `orderLines`.
4. **Is it a capability**, where nothing short of writing it is evidence? → `codeEditor`.
5. **Is it a distinction** between two things that look alike — `let` vs `var`, map vs flatMap? → `recognition` with the options written as code.
6. **None of the above.** → A plain `recall` or `application` item, exactly as you would write for any other concept.

**Six is the right answer roughly half the time, even here.** "Why memoisation changes the complexity class" is answered in a sentence. So is "when would you reach for a reducer instead of state". Writing a plain item for those is the job done correctly — a blank cut into a listing for a concept that has no boundary produces a question about the format instead of about the idea.

### Second: how many

You get **6 to 8 items**, and **at most 2 of them may use a rich answer format** (`clozeCode`, `hotspotLine`, `orderLines`, `codeEditor`). The rest are plain.

This is a time budget, not a style preference. The learner has about fifteen minutes a day and today already holds two new concepts plus six reviews from earlier ones. A plain item costs ~10 seconds; `hotspotLine` 8–15s; `clozeCode` 15–30s; `orderLines` 25–45s; `codeEditor` **two to four minutes**. Each of these items comes back seven or eight times over thirty days, so an expensive item is an expensive *habit*. Reviews have to stay cheap or they stop happening.

`codeEditor` is at most **one per concept**, and only for a genuine capability.

### Third: earn it

Every rich format requires one sentence that you can only write if the format was the right choice. These are checked; an item missing one is rejected and regenerated.

- `clozeCode.failure` — the concrete input where the most likely wrong answer breaks. *"`search([4], 4)` returns -1."* If you cannot name one, the blank is not on the boundary: move it, or write a plain item.
- `hotspotLine.failure` — the same sentence, for the line you marked.
- `orderLines.swapBreaks` — which two lines, swapped, break it, and what breaks. If no pair can be named, the lines are independent and the order was never the point.
- `codeEditor.whyWhole` — what writing the whole function tests that a blank would not.

A vague sentence here is easy to write and a *specific* false one is not, which is exactly why the field exists.

### Transfer items are usually plain

A transfer item applies the concept in a context it was **not** taught in. A blank cut into the same listing the concept was taught with is not transfer, whatever it is labelled — and `isTransfer` is a measured outcome, so mislabelling it corrupts a result rather than just reading oddly. Prefer a plain item that puts the idea in a new setting.

### Hard limits

- **≤12 lines** per listing, **≤2 holes**, **≤3 margin notes**.
- Runnable, idiomatic code. Never pseudocode, and never `// ...` where the concept lives.
- **Never write a line number.** Quote the line's text — `lineQuote`, `fromQuote`, `toQuote` — and it will be matched against the listing. A quote that matches no line, or two, is rejected, so quote enough of the line to be unambiguous.
- Every block needs a `slot`: `context` for something read, `answer` for the one thing done, `reveal` for what is shown afterwards. **At most one `answer` block per item**, and never one on a `recognition` or `explain` item — those already have an answer surface.
- `prompt` stays required on every item, blocks or not. It is what a screen reader and the extension read.

### Worked example — concept: "Exclusive upper bound in binary search"

This concept **is** a rule with a boundary, so one item gets a `clozeCode` and the rest stay plain. Eight items, two rich, one transfer.

```json
{
  "type": "application",
  "prompt": "Complete the loop condition so the last element is still searched.",
  "answer": "lo < hi",
  "accept": ["lo<hi"],
  "isTransfer": false,
  "blocks": [
    { "kind": "code", "slot": "context", "lang": "javascript", "src": "function search(a, x) {\n  let lo = 0;\n  let hi = a.length;\n  while (lo < hi) {\n    const mid = (lo + hi) >> 1;\n    if (a[mid] === x) return mid;\n    a[mid] < x ? (lo = mid + 1) : (hi = mid);\n  }\n  return -1;\n}", "short": null, "notes": [{ "lineQuote": "let hi = a.length;", "text": "one past the end, not the last index" }], "dim": null },
    { "kind": "clozeCode", "slot": "answer", "lang": "javascript", "src": "while ({{1}}) {", "holes": [{ "id": 1, "answer": "lo < hi", "accept": ["lo<hi"], "width": 8 }], "failure": "With `lo <= hi` the loop reads a[a.length] on the last step, which is undefined." }
  ]
}
```

### Contrastive pairs — the same concept done wrong and right

**A blank in the wrong place.**

- ✗ `const {{1}} = (lo + hi) >> 1;` — the blank is on the variable *name*. A learner who has forgotten the whole idea still writes `mid`. It tests nothing, and no `failure` sentence can be written for it.
- ✓ `while (lo {{1}} hi)` — the blank is on the boundary. `failure` writes itself, and getting it wrong is exactly the misconception.

**A `codeEditor` that should not be one.**

- ✗ *"Write a function that explains why memoisation is faster."* Four minutes to produce a paragraph. The concept is a reason; this is an `explain` item wearing a costume.
- ✓ *"Write `debounce(fn, ms)`."* `whyWhole`: "A blank cannot test that the timer handle is kept — only writing the whole function forces you to store `t` and clear it."

**A `hotspotLine` with nothing to click.**

- ✗ A listing whose bug is a *missing* cleanup line. You cannot click a line that is not there.
- ✓ The same listing, marking the line that has to change, with `acceptAdjacent: true` so its neighbour also counts.

**A rich item labelled transfer.**

- ✗ A second `clozeCode` in the same listing, `isTransfer: true`. Same code, same setting — that is a second attempt, not transfer.
- ✓ A plain `application` item applying the exclusive-bound idea to a sliding-window loop the teaching never showed.
