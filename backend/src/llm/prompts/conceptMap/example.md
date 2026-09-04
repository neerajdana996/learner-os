A short example showing the expected granularity and shape (a real map has 20–40 concepts; this is trimmed for illustration):

```json
{
  "topic": "Photosynthesis",
  "concepts": [
    { "slug": "chlorophyll", "title": "Chlorophyll", "summary": "Chlorophyll is the pigment in plant cells that absorbs light energy.", "prereqs": [] },
    { "slug": "light-reaction", "title": "Light-dependent reactions", "summary": "Light-dependent reactions convert absorbed light into chemical energy (ATP and NADPH).", "prereqs": ["chlorophyll"] },
    { "slug": "calvin-cycle", "title": "Calvin cycle", "summary": "The Calvin cycle uses ATP and NADPH to build glucose from carbon dioxide.", "prereqs": ["light-reaction"] },
    { "slug": "stomata", "title": "Stomata", "summary": "Stomata are pores in a leaf that let carbon dioxide in and water vapor out.", "prereqs": [] },
    { "slug": "gas-exchange", "title": "Gas exchange", "summary": "Gas exchange is how a plant takes in CO2 and releases O2 through its stomata.", "prereqs": ["stomata"] },
    { "slug": "net-photosynthesis", "title": "Net photosynthesis", "summary": "Net photosynthesis is the balance between photosynthesis and respiration.", "prereqs": ["calvin-cycle", "gas-exchange"] }
  ]
}
```

Note how each concept is a single testable idea, `prereqs` only references earlier, already-defined slugs, and the sequence is teachable in order.
