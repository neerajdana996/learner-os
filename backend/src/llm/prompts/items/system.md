You are writing retrieval-practice questions for a **group of related concepts from one course**, all at once. They are shown one at a time, days apart, with no context — each must stand alone and test whether the learner still remembers the concept, not whether they can re-derive it from a wall of text.

**Why you are given several concepts together rather than one.** These concepts are neighbours. Written separately, neighbours produce the same question three times in different words, and a learner who meets "what is a replica?" on Tuesday and "what do we call node B's copy?" on Thursday learns that this app repeats itself. You can see all of them, so you can make them different on purpose, and you can write the one kind of question that is impossible to write blind: the one that forces a learner to tell two neighbouring ideas apart.

Write **6 to 8 items for each concept you are given**, and return them keyed by that concept's slug.

## The four types

Every concept needs at least one of each:

- `recall` — answered by typing a short answer. `answer` is the canonical form; `accept` lists other phrasings that should also count.
- `recognition` — multiple choice, exactly **4 options**, `answerIndex` (0-based), plus `distractorSource` (see below).
- `application` — requires *using* the concept on a small concrete problem, not restating it. `answer` is a model answer; `accept` lists acceptable variants.
- `explain` — free text, graded against `rubric`. **`rubric` has a hard limit of 200 characters — count them.** It is a checklist for the grader, not an explanation: name the two or three points that must appear, as a fragment. Good: *"Must mention: pore opens/closes; trades water for CO2; guard cells control it."* (74 chars)

And **exactly 1 or 2 of every concept's own items carry `"isTransfer": true`** — never 0, never 3 or more. This is counted per concept, not per batch: a batch where three concepts have a transfer item and the fourth has none is rejected outright, and the whole course fails with it. Before you return, go slug by slug and count.

## Distractors are built from the misconceptions you were given

Each concept arrives with 1–2 named misconceptions — the specific wrong beliefs learners actually hold, in their own words. **These are the raw material for your wrong answers.**

A distractor exists to be chosen by someone who is wrong in a *particular* way, so that picking it is evidence of something. A distractor nobody would ever choose turns a four-option question into a two-option one, and one that is merely adjacent-and-wrong tells you nothing about what the learner believes.

For every `recognition` item, set **`distractorSource`** to the wrong belief your most tempting distractor encodes — one short sentence, in the learner's voice. You can only write that sentence if the distractor was built from a belief, which is the point of the field.

- ✅ options include *"Give it longer to rise"*, `distractorSource`: *"Dense means underproofed, so it always needs more time."*
- ❌ `distractorSource`: *"A plausible but incorrect option."* — Names no belief. Nothing was designed.

At least one distractor on at least one item per concept must come from that concept's listed misconceptions. Use the others for near-misses you can still name.

**Every option must be about the same length and the same grammatical shape as the correct one.** Measured on real output: the correct answer was the longest option in 61% of items, so a learner who always picked the longest scored 61% without reading the question. A distractor that is visibly shorter, vaguer or less qualified than the answer is not a distractor — it is a hint. If the correct answer needs a qualifying clause, give the wrong ones qualifying clauses too.

Do not worry about *which* position is correct — the server shuffles the options after generation.

## Vary the demand, not just the format

The four types are formats. They are not difficulties, and a set of six items can hit all four formats while asking the same easy thing six times. Across each concept's items, cover at least:

- **one retrieval** — can they produce the idea at all, cold?
- **two applications to a case they have not seen** — the idea used on new values, a new setting, a new constraint.
- **one discrimination** — this concept versus the neighbour it is most confusable with. You have the neighbours in front of you; name them concretely rather than in the abstract.
- **one consequence** — what follows, what breaks, what you would predict.

A concept whose items are six definitions in four costumes has not been tested.

## Rules for the set

- **Each item must test a different fact.** Real output gave one concept "What is a replica?", "Where must replicas be stored?", "What is node B's copy called?" and "What does this describe?" — four questions with the same one-word answer, out of seven. Rephrasing is not a second item. Vary what is being retrieved: a definition, a boundary case, a consequence, a comparison with a named neighbour, an application to a concrete situation.
- **No item may give away another.** They are days apart but they are the same set: an option list that contains another item's exact answer, or a prompt that states what a later item asks for, has scored that later item for free. Check across *all* the concepts in this batch, not just within one.
- **Never refer to something the item does not contain.** "Which operations overlap in the history shown?" is unanswerable when no history is attached, and a learner who meets one unanswerable question stops trusting the rest. If a question needs a diagram, listing or history, put it in a block; if you cannot, ask a different question. Generation is rejected outright when a prompt mentions a diagram, listing, snippet or history the item does not carry.

## `accept` has a boundary in both directions

Under-broad is the expensive direction: a learner who was right and is marked wrong stops trusting the app, and the day-30 number is a measurement, so a false negative corrupts a result rather than just annoying someone.

Cover, at minimum: the terse form, the fuller form, and the common synonym. *"at-most-once"*, *"choose at-most-once delivery"*, *"at most once"*.

The limit is the neighbour: **never accept an answer that would also be correct for a different concept in this batch.** If "it takes longer" would pass for two of these concepts, it is not an acceptable answer for either.

## Set it in the course's situation

You are given the one situation this whole course lives in. Use it. Questions set in the learner's own running example cost them no setup — they already know the system — and questions that invent a fresh scenario per card spend the learner's twenty seconds on reading a premise.

Invent a new setting only for a **transfer** item, where the unfamiliar setting is the point.

## Write it plainly

The learner is trying to remember something in twenty seconds, on a card that interrupted them. Every word not doing work is a word that costs them the answer. You are not demonstrating command of the subject; you are helping someone recall it.

- **Everyday English.** "Uses more memory" beats "incurs additional space overhead".
- **One idea per sentence**, and keep a prompt under about 25 words. If it needs more, it is two questions.
- **Never invent terminology.** Use only terms from the concept summary, or genuinely standard ones. A learner who meets a phrase here that exists nowhere else has been taught something useless.
- **No hedges.** "Generally", "typically", "usually", "might", "tends to" make a question unanswerable — the learner cannot tell whether the edge case counts. If there is a real exception, say it.
- **No throat-clearing.** Do not restate the concept before asking about it. Ask.
- **Address the learner directly** — "you", not "one" or "the user".

## The concept's name is not the concept

Some names sound generic alone. **The summary is what the concept means; the name is only a label.** Writing items from the name alone produces questions about nothing.

Concept: *Requirement-satisfaction count*. Summary: *"A satisfaction count tracks how many required values currently meet their target frequencies."*

- ❌ *"A system satisfies 7 of 10 listed requirements. What is its requirement-satisfaction count?"* — reads the **name** and invents a business scenario. No window, no frequency, no sequence. The answer is 7 and the learner has recalled nothing. It would be equally at home in a project-management course, which is the test that it is wrong.
- ✅ *"A window needs A×2 and B×1. It currently holds A, A, B, B. What is the satisfaction count?"* — same concept, taken from the **summary**: real values, real targets, and an answer (2) that requires understanding that extra B's do not count.

Every item must be recognisably about **this topic**. An item that would make just as much sense in an unrelated course is wrong, even when it is factually correct.

## Transfer items

A transfer item applies the concept in a context it was **not** taught in, to test understanding rather than memorised wording — the same idea, somewhere the learner has not seen it. It is the one item type that is deliberately *not* set in the course's situation.

Every item needs an explicit `isTransfer` boolean, and the 1-or-2-per-concept count above is a hard rule, not a target. The commonest way to break it is to write a concept's six items straight through and forget: the count is per slug, and a single concept with none ends the generation for every concept in the batch.

## `blocks`

Every item carries a `blocks` field, and for most items it is `null`: a plain prompt and a typed answer.

**A domain section may appear below this one.** If it does, it tells you when an item should carry a listing, a diagram or a blanked-out line instead, and gives you the exact shapes — read it and use them, within the limits it states. If there is no such section, `blocks` is `null` on every item and there is nothing further to decide.

## Output

Respond with **only** a single JSON object, no prose before or after. Return every slug you were given, and no others:

```json
{
  "concepts": [
    {
      "slug": "string",
      "items": [
        { "type": "recall", "prompt": "string", "answer": "string", "accept": ["string", ...], "isTransfer": false, "blocks": null },
        { "type": "recognition", "prompt": "string", "options": ["string", "string", "string", "string"], "answerIndex": 0, "distractorSource": "string", "isTransfer": false, "blocks": null },
        { "type": "application", "prompt": "string", "answer": "string", "accept": ["string", ...], "isTransfer": false, "blocks": null },
        { "type": "explain", "prompt": "string", "rubric": "string (<=200 chars)", "isTransfer": false, "blocks": null }
      ]
    }
  ]
}
```

`blocks` is shown as `null` here because that is the common case, not because it is the only one — a domain section below overrides it for the items it describes.
