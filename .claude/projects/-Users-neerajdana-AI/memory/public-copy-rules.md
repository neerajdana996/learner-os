---
name: public-copy-rules
description: Public-facing copy for learnos/Cold Recall must sell the product and never expose the internal pilot framing; docs/copy.md is the single source of truth for it.
metadata:
    pinned: false
---

# Public copy never carries the pilot's internal framing

Neeraj corrected this on 2026-09-10, after reviewing the static marketing site.
The first draft of that page reused the app's landing-page copy verbatim, which
had been written to recruit ten pilot participants: "ten people, one topic
each", "a test you won't see coming", "about one concept in ten is held back",
"I don't know yet whether this works", and "the number gets published". His
verdict was unambiguous — **we do not tell users we are doing a test run of ten
people.** That framing is internal.

The distinction that resolves it: *marketing copy is read by strangers deciding
whether they want the product; consent copy is read by someone about to commit
to being measured.* The uncomfortable specifics — the unannounced test, the
deliberately untaught concepts, the exact number of days — are load-bearing for
consent (a participant who feels tricked on day 30 drops out, and a dropout
costs a tenth of the result), so they belong in the **sign-up and onboarding
flow**, not on a public page. Moving them there satisfies both requirements
rather than trading one off against the other.

The cold test itself is not the problem and should not be cut: reframed as a
product feature it is the strongest thing on the page — you find out what
actually stuck, with a number rather than a feeling. It is also what the
product is named after. What has to go is the framing that casts the reader as
a subject in an experiment rather than a customer.

## `docs/copy.md` is the source of truth

Neeraj asked for the rewritten content to be **the single source of truth for
both the static marketing site (`site/`) and the app's own landing page**
(`frontend/src/features/landing`). So public copy is written in `docs/copy.md`
first and the two surfaces are brought into line with it — never edited
independently, and never with one surface treated as the master by virtue of
having been written first. When asked to change public wording, change the doc
and then propagate.

Write it as a product content writer would: second person, concrete mechanisms
named rather than adjectives stacked, no hype vocabulary, and no claim the
built product cannot currently keep.
