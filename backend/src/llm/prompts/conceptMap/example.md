A short example showing the expected granularity and shape (a real map has 14–16 concepts; this is trimmed for illustration):

```json
{
  "topic": "Photosynthesis",
  "concepts": [
    { "slug": "chlorophyll", "title": "Chlorophyll", "summary": "Chlorophyll is the pigment in plant cells that absorbs light energy.", "prereqs": [], "domain": "prose" },
    { "slug": "light-reaction", "title": "Light-dependent reactions", "summary": "Light-dependent reactions convert absorbed light into chemical energy (ATP and NADPH).", "prereqs": ["chlorophyll"], "domain": "prose" },
    { "slug": "calvin-cycle", "title": "Calvin cycle", "summary": "The Calvin cycle uses ATP and NADPH to build glucose from carbon dioxide.", "prereqs": ["light-reaction"], "domain": "systems" },
    { "slug": "stomata", "title": "Stomata", "summary": "Stomata are pores in a leaf that let carbon dioxide in and water vapor out.", "prereqs": [], "domain": "prose" },
    { "slug": "gas-exchange", "title": "Gas exchange", "summary": "Gas exchange is how a plant takes in CO2 and releases O2 through its stomata.", "prereqs": ["stomata"], "domain": "prose" },
    { "slug": "net-photosynthesis", "title": "Net photosynthesis", "summary": "Net photosynthesis is the balance between photosynthesis and respiration.", "prereqs": ["calvin-cycle", "gas-exchange"], "domain": "math" }
  ]
}
```

Note how each concept is a single testable idea, `prereqs` only references earlier, already-defined slugs, and the sequence is teachable in order.

Note the domains too. This is a **biology** topic and not one concept is `code` — subject has nothing to do with it. `calvin-cycle` is `systems` because a correct answer is an ordering of steps, and `net-photosynthesis` is `math` because a correct answer is a balance you compute. Most of the rest are `prose` because a correct answer is a sentence, and that is the normal case.

Note the titles as well. Every one is a term a biologist would actually say —
"Calvin cycle", "Stomata", "Gas exchange". None of them is a coined compound
like "chlorophyll absorption state" or "stomatal aperture predicate". Name the
idea the way the field names it.
