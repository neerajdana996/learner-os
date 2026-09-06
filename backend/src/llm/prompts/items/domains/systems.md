---

## This concept is systems

A correct answer to this concept is a **shape** — a topology, an ordering of events, or a number you estimate. Some of its items may carry **blocks** instead of being a prompt string and a text box.

You describe the drawing; you never draw it. Emit nodes and edges, or lanes and messages. The renderer turns them into a picture. **Never emit SVG, markup, or coordinates** — those fields are rejected.

### First: does this concept even want one?

Work down this list and **stop at the first yes**. Do not read ahead and pick the most interesting one.

1. **Is it an ordering — who saw what, and when?** A stale read, a lost update, a write that overtook another. The bug is in the interleaving, not in the boxes. → `sequence`.
2. **Is it a topology** — which component talks to which, and where a thing sits? A cache in front of a database, a replica behind a primary. → `diagram`.
3. **Is the answer a number you estimate?** Capacity, throughput, how many replicas. → `numeric`.
4. **Is it a distinction** between two arrangements that sound alike — read-through vs write-through, sync vs async replication? → `recognition`, with the options written as plain descriptions.
5. **None of the above.** → A plain `recall` or `application` item, exactly as for any other concept.

**Five is the right answer roughly half the time, even here.** "Why a quorum of two out of three tolerates one failure" is answered in a sentence. So is "when you would choose eventual consistency". Writing a plain item for those is the job done correctly — a diagram drawn for a concept with no topology produces a question about the picture instead of about the idea.

### Second: how many

You get **6 to 8 items**, and **at most 2 of them may carry a drawing** (`diagram` or `sequence`). The rest are plain.

This is a time budget, not a style preference. A plain item costs ~10 seconds; a `sequence` you must read before answering is 20–40s; a `numeric` is 15–30s. Each item comes back three or four times inside the teaching week, so an expensive item is an expensive *habit*.

### Third: earn it

A drawing is context. It must be the thing the question is *about*, not decoration above a question that would read identically without it.

**The test: delete the drawing. Can the item still be answered?** If yes, the drawing was decoration — remove it and write a plain item. If the question becomes unanswerable, the block earned its place.

`alt` is required on every drawing and is not optional politeness: it is what a screen reader reads, and the extension is a notification-driven surface people reach with a keyboard. Write what the drawing *shows*, not that a drawing exists. Good: "A client writes to the primary, which replicates to a replica asynchronously; the client then reads from the replica." Useless: "A diagram of replication."

### Hard limits

- `diagram`: **2–5 nodes**, ≤8 edges. Node labels ≤28 characters, edge labels ≤24. Five is a cap, not a target — a concept needing six boxes has not been split into one idea yet.
- `sequence`: **2–3 lanes**, 2–8 messages. Lane names are participants ("Client", "Primary", "Replica"), never verbs.
- `numeric`: `answer` is a number and `tolerance` is a **fraction** — `0.1` accepts ±10%, `0.5` accepts an order-of-magnitude estimate. Put the unit in `unit`; never ask the learner to type it.
- `edges` and `messages` reference nodes and lanes **by the exact `id` or lane name**. A reference that matches nothing is dropped from the drawing, so the question loses the arrow it was about.
- `prompt` stays required on every item, blocks or not. It is what a screen reader and the extension read.
- Every block needs a `slot`: `context` for something read, `answer` for the one thing done. `diagram` and `sequence` are always `context`; `numeric` is always `answer`. **At most one `answer` block per item**, and never one on a `recognition` or `explain` item — those already have an answer surface.

### Worked example — concept: "A read from a replica can be stale"

This concept **is** an ordering, so one item gets a `sequence` and the rest stay plain.

```json
{
  "type": "recognition",
  "prompt": "The client reads x and gets 0, having just written x=1. Why?",
  "options": [
    "The write was lost",
    "The read reached the replica before replication did",
    "The primary rejected the write",
    "The client cached the old value"
  ],
  "answerIndex": 1,
  "isTransfer": false,
  "blocks": [
    {
      "kind": "sequence",
      "slot": "context",
      "lanes": ["Client", "Primary", "Replica"],
      "messages": [
        { "from": "Client", "to": "Primary", "label": "write x=1", "delayed": null },
        { "from": "Client", "to": "Replica", "label": "read x", "delayed": null },
        { "from": "Replica", "to": "Client", "label": "x=0", "delayed": null },
        { "from": "Primary", "to": "Replica", "label": "replicate x=1", "delayed": true }
      ],
      "alt": "A client writes x=1 to the primary, then reads x from the replica and gets 0. The primary's replication of x=1 arrives after the read."
    }
  ]
}
```

Note the `delayed: true` on the replication. That single flag *is* the concept — it is what makes the drawing show a bug rather than a happy path.

### `delayed` is not decoration — decide about it every time

Before writing any `sequence`, answer this: **is the concept the thing working, or the thing failing?**

- **Failing** — a stale read, a lost update, a write that overtook another, convergence that has not happened yet. **Exactly one message is `delayed: true`**, and it is the one that arrives too late. Without it the drawing shows the happy path and the question has no answer, because nothing on the page is wrong.
- **Working** — a causal chain, a valid history, an ordering that holds. **No message is delayed.** Adding one would draw a violation and then ask why the rule is satisfied.

A sequence with no delayed message is correct only when the concept really is about the ordering holding. If you are drawing a failure and every arrow is horizontal, you have drawn the case where the bug does not happen.

### Contrastive pairs — the same concept done wrong and right

**A drawing that is decoration.**

- ✗ A `diagram` of a client, a load balancer and two servers, above the question "What does a load balancer do?" Delete the picture and the question is unchanged. It cost the learner ten seconds and taught nothing.
- ✓ The same three boxes, above "One server is draining. Which arrow stops first?" Delete the picture and the question is unanswerable.

**A sequence with no interleaving.**

- ✗ Client → Primary → Client, in order, nothing delayed. That is a request and a response; it is a paragraph, not a drawing.
- ✓ The same three messages plus a fourth that arrives late. The order is now the answer.

**A number graded as a string.**

- ✗ `recall` with `answer: "6GB"` and `accept: ["6 GB", "6e9", "6,000,000,000 bytes"]`. You will never list every spelling, and a learner who typed `6.1GB` was right.
- ✓ `numeric` with `answer: 6e9`, `tolerance: 0.5`, `unit: "bytes"`. An order-of-magnitude estimate is the skill; the spelling never was.

**A topology question that is really a definition.**

- ✗ A `diagram` above "What is a replica?" — the concept is a definition, and a definition has no shape.
- ✓ A plain `recall` item. Half the concepts in this category are plain, and that is the job done correctly.
