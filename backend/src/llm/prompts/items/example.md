A batch of two concepts from the **Sourdough baking** course. Spine: *one 1000g white loaf, 70% hydration, cool kitchen, Dutch oven*.

- `starter-activity` — *"A starter is ready when it has roughly doubled and is domed and bubbly, which is about timing since its last feed, not about how much of it you use."* Misconceptions: *"A dense loaf means my starter is weak."*, *"More starter in the dough makes the loaf rise more."*
- `underproof-vs-overproof` — *"Both come out dense, but underproofed bread has a tight crumb and a torn, dramatic ear while overproofed bread is flat, gummy and barely opens."* Misconceptions: *"Dense means underproofed, so I should always give it longer."*, *"An overproofed loaf would have collapsed in the oven, so mine can't be."*

Trimmed to 4 items each; a real batch has 6–8 per concept.

```json
{
  "concepts": [
    {
      "slug": "starter-activity",
      "items": [
        {
          "type": "recall",
          "prompt": "What tells you your starter is ready to mix into the dough?",
          "answer": "it has roughly doubled since its last feed and is domed and bubbly",
          "accept": ["doubled and domed", "risen to about double with a domed top", "about double, bubbly and domed"],
          "isTransfer": false
        },
        {
          "type": "recognition",
          "prompt": "Your loaf came out dense. What does that tell you about your starter?",
          "options": [
            "Nothing on its own — a dense loaf has several possible causes",
            "It is weak, because a strong starter produces an open crumb",
            "It is over-fed, because excess flour weighs the dough down",
            "It is fine, because starter strength does not affect the crumb"
          ],
          "answerIndex": 0,
          "distractorSource": "A dense loaf means my starter is weak.",
          "isTransfer": false
        },
        {
          "type": "application",
          "prompt": "You fed your starter at 8am and it doubled by noon. It is now 4pm and it has sunk back down. Use it or feed it again?",
          "answer": "feed it again — it has passed its peak",
          "accept": ["feed it and wait for it to double again", "don't use it, it's past peak", "refresh it first"],
          "isTransfer": false
        },
        {
          "type": "explain",
          "prompt": "Explain why doubling the starter in the recipe does not double the rise.",
          "rubric": "Must mention: starter sets fermentation speed not final volume; more starter ferments faster; the rise comes from time at temperature.",
          "isTransfer": true
        }
      ]
    },
    {
      "slug": "underproof-vs-overproof",
      "items": [
        {
          "type": "recall",
          "prompt": "Which part of a dense loaf tells you whether it was underproofed or overproofed?",
          "answer": "the ear — how far the score opened",
          "accept": ["the ear", "how much the score opened", "the crust, not the crumb"],
          "isTransfer": false
        },
        {
          "type": "recognition",
          "prompt": "Your loaf is dense, with a tight crumb and a sharply torn ear. What went wrong?",
          "options": [
            "Underproofed — it had gas left to give and tore releasing it",
            "Overproofed — it had no gas left and tore under the oven heat",
            "Underbaked — the crumb set before the loaf finished rising",
            "Overhydrated — the extra water weighed the crumb down"
          ],
          "answerIndex": 0,
          "distractorSource": "An overproofed loaf would have collapsed, so a torn ear must mean it went too far.",
          "isTransfer": false
        },
        {
          "type": "application",
          "prompt": "Your loaf is dense, flat and gummy, and barely opened in the oven. Do you give the next one more time or less?",
          "answer": "less — it was overproofed",
          "accept": ["less time", "shorten the bulk", "cut the proof shorter"],
          "isTransfer": false
        },
        {
          "type": "recognition",
          "prompt": "Two dense loaves: one has a tight crumb and a torn ear, the other is flat and gummy. What separates them?",
          "options": [
            "How much gas was left in the dough when it went into the oven",
            "How active the starter was when it was mixed into the dough",
            "How much water the recipe called for relative to the flour",
            "How hot the oven was during the first ten minutes of the bake"
          ],
          "answerIndex": 0,
          "distractorSource": "A dense loaf means my starter is weak, so the difference must be starter strength.",
          "isTransfer": false
        },
        {
          "type": "explain",
          "prompt": "Your kitchen is 6°C colder than last week and your loaf is dense. Explain how you would tell which of the two failures it is.",
          "rubric": "Must mention: read the crumb and ear, not the clock; tight crumb plus torn ear is under; flat and gummy is over; cold slows fermentation so under is likelier.",
          "isTransfer": true
        }
      ]
    }
  ]
}
```

**The two concepts were written against each other, which is why they are given together.** `underproof-vs-overproof`'s third item is a discrimination item, and it exists only because the other concept was visible: the tempting wrong answer is *starter strength*, which is exactly what `starter-activity` covers and exactly what this learner already believes. Generated separately, neither concept could have produced that question, and both would probably have produced some version of *"what makes a loaf dense?"*.

**Every `distractorSource` names a belief, in the learner's voice.** Look at the first `starter-activity` recognition item: the correct answer is *"Nothing on its own"*, and the tempting distractor is *"It is weak"* — which is the course's central misconception, verbatim from the map. Someone who picks it has told you precisely what they still think. A distractor like *"the starter was too cold"* would be wrong-and-plausible and would have told you nothing.

**Option lengths are level.** In the first item the correct option is 57 characters and the three distractors are 61, 63 and 58. The correct answer is not the longest, not the most qualified, and not the only one with a reason attached — all three of the others carry a "because" clause too. A learner who has forgotten the concept gets no help from the shape of the page.

**The demand is spread, not just the format.** For `underproof-vs-overproof`: one retrieval-shaped recognition, one application to a specific loaf, one discrimination against the named neighbour, one consequence question that puts it in a changed environment. Four formats would have been satisfied by four definitions; this set cannot be answered by anyone who only memorised *"underproofed means not enough time"*.

**`accept` is wide but stops at the neighbour.** *"less time"*, *"shorten the bulk"*, *"cut the proof shorter"* are all the same answer in different words and all pass. *"give it longer"* does not — and notice that *"it was underproofed"* is deliberately **not** in the accept list for that item, because that is the other half of this very concept. An `accept` list generous enough to swallow the neighbouring answer has stopped measuring anything.

**Everything non-transfer is set in the spine.** The 8am feed, the cool kitchen, the loaf that came out of the Dutch oven — the learner never reads a premise they have not already met. The two transfer items are the exceptions, and they earn it: one moves to a changed kitchen temperature, the other to a recipe-scaling question, both settings the concept was not taught in.
