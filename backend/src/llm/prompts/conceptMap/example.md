The map for the scoped **Sourdough baking** course — `working` level, four capabilities, spine "one 1000g white loaf in a cool kitchen", central misconception *"A dense loaf means my starter is weak, so I should use more of it."*

Trimmed to 11 concepts for illustration; a real map has 14–16.

```json
{
  "topic": "Sourdough baking",
  "crux": ["time-and-temperature", "bulk-vs-final-proof", "underproof-vs-overproof"],
  "concepts": [
    {
      "slug": "bakers-percentage",
      "title": "Baker's percentages",
      "summary": "Every ingredient is written as a percentage of the flour weight, so recipes scale without arithmetic.",
      "prereqs": [],
      "serves": ["scale-a-recipe"],
      "domain": "math",
      "hardBecause": "not-hard",
      "misconceptions": ["The percentages should add up to 100."]
    },
    {
      "slug": "hydration",
      "title": "Hydration",
      "summary": "Hydration is water as a percentage of flour, and it sets how slack the dough is and how open the crumb can get.",
      "prereqs": ["bakers-percentage"],
      "serves": ["scale-a-recipe", "read-the-dough"],
      "domain": "math",
      "hardBecause": "counterintuitive",
      "misconceptions": [
        "My dough is too sticky, so I should use less water next time.",
        "Higher hydration means a wetter, heavier loaf."
      ]
    },
    {
      "slug": "starter-activity",
      "title": "What an active starter looks like",
      "summary": "A starter is ready when it has roughly doubled and is domed and bubbly, which is about timing since its last feed, not about how much of it you use.",
      "prereqs": [],
      "serves": ["diagnose-dense-crumb", "change-one-variable"],
      "domain": "prose",
      "hardBecause": "confusable-neighbour",
      "misconceptions": [
        "A dense loaf means my starter is weak.",
        "More starter in the dough makes the loaf rise more."
      ]
    },
    {
      "slug": "gluten-network",
      "title": "The gluten network",
      "summary": "Kneading and folding line up proteins into a stretchy web, and that web is what traps the gas the yeast makes.",
      "prereqs": [],
      "serves": ["read-the-dough", "diagnose-dense-crumb"],
      "domain": "prose",
      "hardBecause": "no-prior-hook",
      "misconceptions": ["Kneading more is always better."]
    },
    {
      "slug": "what-fermentation-does",
      "title": "What fermentation does to the dough",
      "summary": "Yeast makes the gas that inflates the dough while bacteria make acid that first strengthens the gluten and then, given long enough, breaks it down.",
      "prereqs": ["gluten-network", "starter-activity"],
      "serves": ["diagnose-dense-crumb", "read-the-dough"],
      "domain": "prose",
      "hardBecause": "many-moving-parts",
      "misconceptions": [
        "Fermentation is just the dough getting bigger.",
        "Longer fermentation is always better for flavour and structure."
      ]
    },
    {
      "slug": "time-and-temperature",
      "title": "Time and temperature trade against each other",
      "summary": "Fermentation runs roughly twice as fast for every 8°C warmer, so a recipe's timings only hold at the temperature they were written for.",
      "prereqs": ["what-fermentation-does"],
      "serves": ["read-the-dough", "change-one-variable", "diagnose-dense-crumb"],
      "domain": "math",
      "hardBecause": "counterintuitive",
      "misconceptions": [
        "The recipe says four hours, so four hours is the bulk time.",
        "A cold kitchen means I need more starter to keep up."
      ]
    },
    {
      "slug": "rise-percentage",
      "title": "Judging rise by percentage",
      "summary": "Bulk fermentation is judged by how much the dough has grown — around 50% for this loaf — not by waiting for it to double.",
      "prereqs": ["time-and-temperature"],
      "serves": ["read-the-dough"],
      "domain": "math",
      "hardBecause": "confusable-neighbour",
      "misconceptions": ["Dough is ready when it has doubled in size."]
    },
    {
      "slug": "bulk-vs-final-proof",
      "title": "Bulk fermentation and final proof do different jobs",
      "summary": "Bulk builds the gas and the structure, shaping knocks most of that gas out on purpose, and the final proof refills a loaf that now holds its shape.",
      "prereqs": ["what-fermentation-does"],
      "serves": ["diagnose-dense-crumb", "change-one-variable"],
      "domain": "systems",
      "hardBecause": "confusable-neighbour",
      "misconceptions": [
        "Shaping should be gentle so I don't lose the rise I just built.",
        "Bulk and proof are the same process, just before and after shaping."
      ]
    },
    {
      "slug": "the-poke-test",
      "title": "What the dough tells you when you poke it",
      "summary": "A floured fingertip pressed into the dough springs back fast when it is underproofed, slowly when it is ready, and not at all when it has gone too far.",
      "prereqs": ["gluten-network", "what-fermentation-does"],
      "serves": ["read-the-dough"],
      "domain": "prose",
      "hardBecause": "not-hard",
      "misconceptions": ["If the dent stays, the dough is perfectly ready."]
    },
    {
      "slug": "underproof-vs-overproof",
      "title": "Telling an underproofed loaf from an overproofed one",
      "summary": "Both come out dense, but underproofed bread has a tight crumb and a torn, dramatic ear while overproofed bread is flat, gummy and barely opens.",
      "prereqs": ["bulk-vs-final-proof", "the-poke-test"],
      "serves": ["diagnose-dense-crumb", "change-one-variable"],
      "domain": "prose",
      "hardBecause": "confusable-neighbour",
      "misconceptions": [
        "Dense means underproofed, so I should always give it longer.",
        "An overproofed loaf would have collapsed in the oven, so mine can't be."
      ]
    },
    {
      "slug": "one-change-at-a-time",
      "title": "Changing one thing at a time",
      "summary": "If you alter the water, the starter and the bulk time together, a better loaf tells you nothing about which change did it.",
      "prereqs": ["underproof-vs-overproof", "time-and-temperature"],
      "serves": ["change-one-variable"],
      "domain": "prose",
      "hardBecause": "not-hard",
      "misconceptions": ["My loaf was bad in several ways, so I should fix all of them at once."]
    }
  ]
}
```

**Backward design, visibly.** Every concept carries `serves`, and all four capabilities are covered: `scale-a-recipe` by the two percentage concepts, `read-the-dough` by five, `diagnose-dense-crumb` by six, `change-one-variable` by four. What is *not* here matters as much: no scoring patterns, no banneton choice, no crust colour, no starter maintenance schedule. Those are standard sourdough-course content and every one of them serves nothing on the capability list, so they are cut. That is the rule doing its job.

**The domain calls are the part to study.** This is a **baking** topic and not one concept is `code` — subject has nothing to do with it.

- `bulk-vs-final-proof` is **`systems`**, and it is the call people get wrong. It *sounds* like prose — you could certainly write a sentence about it. But a correct answer is an **ordering**: gas is built, then deliberately expelled by shaping, then rebuilt into a dough that now has the structure to hold it. The learner who cannot put those in order does not understand the concept, and no definition will reveal that. Ordering → `systems`.
- `time-and-temperature` is **`math`**, not prose, because a correct answer is a *factor*: the kitchen is 6°C cooler, so what happens to the four hours? The answer is a number the learner computes, not a sentence about warmth speeding things up.
- `the-poke-test` is **`prose`** even though it is about a physical action, because a correct answer is a distinction between three described outcomes.

**Crux is a ranking, not a label.** Eight of these eleven are important. Three are load-bearing: `time-and-temperature` (the real knob, which is what dismantles the central misconception that the knob is starter quantity), `bulk-vs-final-proof` (get this wrong and every other fix is applied at the wrong stage), and `underproof-vs-overproof` (the discrimination the learner's whole problem rests on — both failures look the same on the outside, and they have opposite fixes). `hydration` and `what-fermentation-does` are genuinely important and did not make the cut. That is what a cap of four is for.

**Misconceptions are in the learner's voice.** *"My dough is too sticky, so I should use less water next time."* is a sentence a person says, and the next phase can build a distractor from it that someone will actually pick. *"Learners misunderstand hydration"* could not.

Note that `starter-activity` carries the course's central misconception verbatim. That is deliberate: the belief the learner arrived with has to be confronted somewhere specific, not left to be dispelled in general.

**`not-hard` is used honestly.** `bakers-percentage`, `the-poke-test` and `one-change-at-a-time` are real, needed, and nobody gets them wrong. Marking everything as difficult would waste the field entirely — these three should be taught with a worked example and no ceremony, and the two-minute attempt that `counterintuitive` earns should be spent on `time-and-temperature` instead.

**Graph shape.** Three roots (`bakers-percentage`, `starter-activity`, `gluten-network`) give three independent threads to teach from. Nothing has more than two prerequisites. The longest chain is `gluten-network → what-fermentation-does → bulk-vs-final-proof → underproof-vs-overproof → one-change-at-a-time`, which is five — at the limit, and deliberately so: it is the diagnostic spine of the course, and everything else hangs off it in parallel so a missed day never blocks the whole map.
