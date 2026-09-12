Topic: **Sourdough baking**. Reason given: *"my loaves come out dense and I don't know which variable to change."*

```json
{
  "topic": "Sourdough baking",
  "level": "working",
  "capabilities": [
    {
      "id": "diagnose-dense-crumb",
      "statement": "Look at a finished loaf and name which stage went wrong.",
      "evidence": "Shown a loaf with a tight crumb and a pale, rounded ear, says the dough was underproofed and points at fermentation time, not at the starter."
    },
    {
      "id": "read-the-dough",
      "statement": "Decide whether a dough is ready to shape from what it looks and feels like, rather than from the clock.",
      "evidence": "Given 'it has been four hours and the dough has risen 30% and springs back fast', says it is not ready and gives the rise-percentage reason."
    },
    {
      "id": "change-one-variable",
      "statement": "Given a failed loaf, choose the single change most likely to fix it, and predict what that change costs.",
      "evidence": "For a dense loaf in a cold kitchen, chooses a longer bulk rather than more starter, and names the risk of overproofing if it runs too long."
    },
    {
      "id": "scale-a-recipe",
      "statement": "Rewrite a recipe for a different flour weight or hydration without breaking the ratios.",
      "evidence": "Converts a 1000g recipe at 70% hydration to 750g and gets the water right."
    }
  ],
  "centralMisconception": "A dense loaf means my starter is weak, so I should use more of it.",
  "spine": {
    "name": "One 1000g white loaf, baked in a home oven in a cool kitchen",
    "description": "1000g bread flour, 700g water, 200g starter, 20g salt, mixed in the evening and baked the next morning in a Dutch oven. Every concept in the course is a decision made about this one loaf, at the point in its timeline where that decision happens.",
    "whyItFits": "It is the loaf the learner is already failing at, which is what `diagnose-dense-crumb` is about — and holding weight and hydration fixed means `change-one-variable` is a real exercise rather than a comparison of two different recipes."
  },
  "assumedKnowledge": [
    "has baked bread before and has an active starter",
    "can weigh ingredients on a kitchen scale",
    "knows what kneading and proving are, roughly"
  ],
  "outOfScope": [
    "keeping and reviving a starter — assumed working, and it is a course of its own",
    "rye, wholemeal and enriched doughs — the variables move differently and seven days is not enough for two flour families",
    "steam ovens, bannetons and other equipment choices — the course works with a Dutch oven and nothing else"
  ]
}
```

**Read the reason, not the topic.** "Sourdough baking" on its own is an `intro` course that starts at "what is a starter". This learner already has a starter and is already baking — they said so by describing their loaves. Teaching them what fermentation is would waste four of the seven days. `working` is right, and the first capability is the one their sentence actually asked for.

**The capabilities are diagnostic, not procedural.** The obvious set here is *"mix, bulk ferment, shape, prove, bake"* — the steps. That is a recipe, not a course, and a learner can already follow a recipe. Every capability above is a *judgement* instead: look at a result and say what happened, look at a dough and decide, pick one change and predict its cost. Those are the things that fail on day 30 if they were never really understood, which is exactly what this app measures.

**The central misconception came from the reason.** *"I don't know which variable to change"* says the learner believes there is one knob, and the knob people reach for is more starter. Stating it in their own voice — *"so I should use more of it"* — is what lets the next phase write a distractor that catches somebody who still believes it. Written as *"learners overestimate starter quantity"* it would catch nobody.

**The spine holds the variables still.** Note what it fixes: one weight, one hydration, one oven, one kitchen temperature. That is not decoration. `change-one-variable` is only a meaningful exercise if everything else is nailed down, so the spine was chosen to make a capability possible rather than to sound homely.

**`outOfScope` draws the line where the days run out**, and says so. "Starter maintenance" is the thing a reasonable person most expects from a sourdough course, which is exactly why it has to be named — an unstated exclusion gets quietly taught anyway, and then the course is nine days long and ends unfinished.

Note also that this is a **baking** topic and the reasoning above is identical to what you would do for a topic on consensus protocols. The subject changes what the spine is; it does not change what a capability is.
