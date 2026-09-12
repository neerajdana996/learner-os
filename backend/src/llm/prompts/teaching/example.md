Concept `underproof-vs-overproof` from the **Sourdough baking** course, `try_first` mode. Spine: *one 1000g white loaf, 70% hydration, cool kitchen, Dutch oven*. Prerequisites already taught: `bulk-vs-final-proof`, `the-poke-test`. Misconceptions given: *"Dense means underproofed, so I should always give it longer."* and *"An overproofed loaf would have collapsed in the oven, so mine can't be."*

The items for this concept are the ones in the item generator's example — including a discrimination question against `starter-activity` and a consequence question about a 6°C colder kitchen.

```json
{
  "tryFirstPrompt": "Two of your loaves came out dense. One has a tight, close crumb and tore open dramatically along the score. The other is flat and slightly gummy and barely opened at all. One spent too long rising and one not long enough — which is which, and what made you sure?",
  "explanationShort": "Both failures are dense, so density tells you nothing on its own — the ear does. An underproofed loaf still has gas left, so it bursts open along the score and keeps a tight crumb. An overproofed loaf has already spent its gas and its gluten is slack, so it spreads flat and barely opens.",
  "explanationLong": "Think about what is left in the dough when it goes into the Dutch oven. Take your usual 1000g loaf and give it a 3-hour bulk in an 18°C kitchen: fermentation has barely started, the dough has risen maybe 20% instead of 50%, and there is a lot of gas still to come. The oven heat releases it all at once, the crust sets before the loaf finishes expanding, and it tears violently along the score — a dramatic ear, and a tight crumb underneath because the gas never had time to spread into an even network. Now run the same loaf for 9 hours instead. The yeast has produced its gas and the acid has been working on the gluten long enough to start breaking it down, so the dough can no longer hold what it has: it slumps when you turn it out, spreads rather than rises, and comes out flat with a gummy, close crumb and a score that never really opened. The crumb reads the same from a photograph in both cases, which is why you read the ear. And these want opposite fixes, so guessing is worse than useless — another hour would have saved the first loaf and finished off the second.",
  "corrections": [
    {
      "wrong": "It came out dense, so I should give it longer next time.",
      "why": "Dense is where both failures land, so it does not pick a direction. Adding time to an already-overproofed loaf makes it flatter and gummier. Read the ear before you change anything: torn and dramatic means more time, flat and closed means less."
    },
    {
      "wrong": "An overproofed loaf would have collapsed in the oven, so mine can't be overproofed.",
      "why": "Collapse is the extreme case, not the normal one. Most overproofed loaves hold their shape well enough to look like an ordinary bake and simply never open — flat, gummy, no real ear. Waiting for a dramatic collapse means you will keep diagnosing these as underproofed."
    },
    {
      "wrong": "The crumb tells me which one it was.",
      "why": "Both are close and tight, which is exactly why this is hard to call from a photo of a slice. The crust is where they separate: the ear and how far the score opened."
    }
  ],
  "teachBlock": null
}
```

**Written against the items, not against the summary.** The third item for this concept asks the learner to separate two dense loaves and offers *starter strength* as the tempting wrong answer. So the explanation opens by ruling density out as a signal and names what to read instead — that is the sentence that has to survive three weeks for that item to be answerable. The fourth item drops the kitchen 6°C, so `explanationLong` runs its worked example at 18°C and states the direction cold pushes you. Neither is answered outright; both are made derivable.

**The worked example has real numbers.** 1000g, 18°C, 3 hours versus 9, 20% rise versus 50%. Compare the version that would have said *"too little time gives a tight crumb and too much gives a flat one"* — true, shorter, and gone by Friday. The learner does not remember the rule; they remember the loaf that rose 20% and tore.

**`try_first` shapes the opening.** This concept is hard because of a confusable neighbour, so the learner has a belief to lose. `tryFirstPrompt` hands them two loaves and makes them commit before anything is explained — most will say the dramatic tear is overproofing, because a violent result feels like too much of something. The explanations are then written as the answer to that specific wrong guess, which is why `explanationShort` leads with what the ear means rather than with a definition.

**Corrections are the list they were given, plus one.** The first two are the map's misconceptions, in the learner's own voice, and the same two the item distractors were built from — so the thing they are warned about and the thing they are tested on are the same thing. The third is an addition: a real mistake worth naming, and there is room for it.

**Prerequisites are named, never re-taught.** The bulk rise and the ear are used as things the learner already has. `bulk-vs-final-proof` gets a passing reference and not a sentence of explanation — it had its own three minutes, and re-teaching it here would cost a third of this one. Nothing in the paragraph leans on `one-change-at-a-time`, which comes later in the course and does not exist yet as far as this learner is concerned.

**It happens in the spine.** The 1000g loaf, the cool kitchen, the Dutch oven — the same loaf as every other concept in this course. The learner spends none of their three minutes learning a new premise.
