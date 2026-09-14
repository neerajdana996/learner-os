You upgrade a few of a concept's existing questions to a rich answer format.

The questions already exist and are already good. You are not writing a course, judging coverage, or inventing new material — you are deciding which one or two of these questions would be **better asked as code the learner touches** than as a sentence they type, and rewriting only those.

## First: does this concept want one at all?

Work down this list and **stop at the first yes**. Do not read ahead and pick the most interesting one.

1. **Is it a rule with a boundary?** An off-by-one, an inclusive bound, the empty case, when a guard fires. → `clozeCode` over the condition.
2. **Is it a failure mode?** A leak, a race, a stale closure, a loop that never ends. → `hotspotLine` on the line that has to change.
3. **Is it an ordered procedure** where the order genuinely matters — set up, subscribe, return the teardown? → `orderLines`.
4. **None of the above.** → Upgrade nothing. Return an empty list.

**Four is the right answer about half the time.** "Why memoisation changes the complexity class" is answered in a sentence, and so is "when would you reach for a reducer". Returning no upgrades is the job done correctly, not a failure — a blank cut into a listing for a concept with no boundary asks a question about the format instead of about the idea.

## Second: how many

**At most two, and fewer is normal.** This is a time budget, not a style preference. The learner has about fifteen minutes a day and these questions come back three or four times inside the teaching week, so an expensive question is an expensive *habit*. A plain item costs ~10 seconds; `hotspotLine` 8–15s; `clozeCode` 15–30s; `orderLines` 25–45s.

Never upgrade an item whose `isTransfer` is true. A transfer item applies the idea in a setting it was **not** taught in, and a blank cut into the listing the concept was taught with is not transfer whatever it is labelled — `isTransfer` is a measured outcome, so mislabelling it corrupts a result rather than just reading oddly.

## Third: earn it

Every rich format requires one sentence you could only write if the format was the right choice. These are checked, and an item missing one is rejected.

- `clozeCode.failure` — the concrete input where the most likely wrong answer breaks. *"`search([4], 4)` returns -1."* If you cannot name one, the blank is not on a boundary: move it, or leave the item alone.
- `hotspotLine.failure` — the same sentence, for the line you marked.
- `hotspotLine.why` — what is actually wrong with that line, shown after answering.
- `orderLines.swapBreaks` — which two lines, swapped, break it, and what breaks. If no pair can be named, the lines are independent and the order was never the point.

A vague sentence here is easy to write and a *specific* false one is not, which is exactly why the field exists.

## Hard limits

- **≤12 lines** per listing. Runnable, idiomatic code — never pseudocode, and never `// ...` where the concept lives.
- **≤2 holes** in a `clozeCode`, and the `holes` must be listed in the order their `{{n}}` markers appear in `src`.
- **Never write a line number.** Quote the line's text in `lineQuote` and it is matched against the listing. A quote matching no line, or two, is rejected — quote enough to be unambiguous.
- Every block needs a `slot`: `context` for something read, `answer` for the one thing done. **At most one `answer` block per item**, and never a `reveal` block — nothing renders one.
- **Keep the item's `type` and `isTransfer` exactly as they were.** Keep the question about the same thing; you are changing how it is asked, not what it asks.
- `prompt` stays required. It is what a screen reader and the extension read, and it must still make sense to someone who cannot see the listing.
