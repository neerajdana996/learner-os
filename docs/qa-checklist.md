# Content QA checklist

> One topic ≈ 1 hour. Do it before anyone is onboarded onto that topic. A wrong
> answer key does not just annoy a learner — it is scored as a failed recall on
> Day 30, so bad content shows up as a bad *result*, and we would never know
> which it was.

## Running it

```bash
cd backend
pnpm qa <topicId>                  # writes qa/<topic>-<id8>.md
# ... review and edit the file ...
pnpm qa:apply qa/<topic>-<id8>.md  # reads the edits back
pnpm qa:retire <itemId>            # drop one question entirely
```

- Edit the text **between** `<!-- learnos:field … -->` and `<!-- /learnos:field -->`. Leave the markers alone: they carry the row id, which is why retitling a concept still lands on the right row.
- Headings, checkboxes and everything outside the markers are for you, not the parser. Tick a concept's box when you have finished it.
- Applying an unedited file changes nothing, and a file that fails to parse changes nothing — you can re-run `qa:apply` as often as you like.
- **The export contains every answer key for a live topic.** `qa/` is gitignored. Don't commit one, don't paste one into a chat, and delete it when you're done.

## What you are checking

Per concept:

- [ ] **Factually correct.** The short and long explanations say something true, and the long one actually adds detail rather than rewording the short one.
- [ ] **The try-first prompt is answerable before being taught.** Productive failure means a learner should be able to *attempt* it from prior knowledge (plan.md §3.5). If it can only be answered by someone who already knows the concept, it is a quiz question, not a try-first prompt.
- [ ] **The title matches the content.** The map shows titles; a misleading one sends the learner to the wrong node.
- [ ] **The misconceptions are real ones.** Read-only in the export — if one is wrong, note it and regenerate the concept (see T-063).

Per item:

- [ ] **The answer key is right.** This is the single highest-value check on the page.
- [ ] **The prompt is unambiguous.** If two different correct answers fit the wording, the grader will mark one of them wrong.
- [ ] **`Also accepted` covers the obvious phrasings.** Recall and application answers are matched leniently (normalised text, ±1% on numbers) and application answers are judged by the model against the key (T-FIX-005) — but an alternative that a competent learner would obviously write belongs in the list.
- [ ] **No distractor is accidentally correct.** The commonest generation failure: for a recognition item, read all four options as if you were arguing *for* each one.
- [ ] **The correct option number is right.** Options are numbered 1–4 in the export; the `Correct option` field is that number, not a zero-based index.
- [ ] **Explain rubrics name what must be present**, not a style preference.
- [ ] **Transfer items really transfer.** An item marked `transfer` must need the idea applied in a situation the teaching did not walk through. A paraphrase of the explanation is not transfer, and it silently weakens the transfer metric (plan.md §7).
- [ ] **No item leaks another item's answer** in its prompt or options.

Held-out concepts (marked `— HELD OUT`):

- [ ] Their items get the **same** scrutiny — they are the control group, scored on Day 30 against the taught concepts, so a bad held-out item biases the comparison the pilot rests on.
- [ ] They have no teaching content, by design. If one has any, that is a generation bug — file it.

## Recording the pass

For T-045, log per topic: minutes spent, items edited, items retired, and the error rate (items changed ÷ items reviewed). That number tells us whether generation is good enough to scale past the pilot, or whether QA is a permanent cost.
