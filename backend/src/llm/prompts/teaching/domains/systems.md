---

## This concept is systems

A correct answer here is a **shape** — a topology or an ordering of events — so `tryFirstPrompt` may point at a drawing instead of describing one in prose. Same rule as the code fragment: you describe the drawing; you never draw it. Emit nodes and edges, or lanes and messages, and the renderer turns them into a picture. **Never emit SVG, markup, or coordinates.**

### First: does this concept even want one?

**Stop and write `teachBlock: null`, `tryFirstPrompt` as plain prose, unless the concept is genuinely about an ordering or a topology.** Most systems concepts still don't want one.

1. **Is the whole point who saw what, and when?** A stale read, a lost update, a message that arrives out of order. The idea *is* the interleaving. → `sequence`, with `tryFirstPrompt` asking what the client observes, or why.
2. **Is the whole point which component talks to which?** A cache in front of a database, a proxy between a client and a set of replicas. → `diagram`, with `tryFirstPrompt` asking what happens if one part of the picture fails or changes.
3. **None of the above — the idea is a trade-off, a definition, or a "when would you".** → `teachBlock: null`. "Why a quorum of two out of three tolerates one failure" is answered in a sentence; a diagram drawn for it produces a question about the picture instead of about the arithmetic.

### Second: earn it

**The test: delete the drawing. Can `tryFirstPrompt` still be answered?** If yes, the drawing was decoration — write `teachBlock: null` instead. If the question becomes unanswerable without it, it earned its place.

`alt` is required and is not optional politeness — it is what a screen reader reads. Write what the drawing *shows*, not that a drawing exists. **Keep it to one or two sentences, 260 characters or fewer** — a diagram with several disconnected parts (e.g. two groups that cannot reach each other) needs a sentence per part plus one naming what cannot happen between them; anything longer is describing more than the drawing needs to say.

### Hard limits

Identical to the items fragment, because this is the same renderer: `diagram` gets 2–5 nodes and at most 8 edges; `sequence` gets 2–3 lanes and 2–8 messages; `alt` is capped at 260 characters. Node and lane labels are participants, never verbs. `delayed` on a `sequence` message is a real decision, not a default — set it only when a message genuinely arrives after a later one was sent, which is what turns a happy-path picture into the bug the question is about.

### Worked example — concept: "A read from a replica can be stale", `try_first` mode

```json
{
  "tryFirstPrompt": "The client just wrote x=1 to the primary, then immediately reads x from a replica and gets 0. Nothing crashed and nothing was lost. What happened?",
  "teachBlock": {
    "kind": "sequence",
    "lanes": ["Client", "Primary", "Replica"],
    "messages": [
      { "from": "Client", "to": "Primary", "label": "write x=1" },
      { "from": "Client", "to": "Replica", "label": "read x" },
      { "from": "Replica", "to": "Client", "label": "x=0" },
      { "from": "Primary", "to": "Replica", "label": "replicate x=1", "delayed": true }
    ],
    "alt": "A client writes x=1 to the primary, then reads x from the replica and gets 0. The primary's replication of x=1 arrives at the replica after the read already happened."
  },
  "explanationShort": "The write succeeded on the primary, but replication to the replica had not caught up yet when the read arrived there. The replica answered honestly with the last value it actually had.",
  "explanationLong": "Asynchronous replication means the primary acknowledges a write as soon as it commits locally, without waiting for every replica to catch up — that is the whole reason it is fast. Between the write completing and the replica receiving it, any read routed to that replica sees the old value, and there is no way for the replica to know a newer value is already in flight. This is not a bug in the ordinary sense: every message arrived and every node behaved correctly, and the staleness is a direct, unavoidable consequence of the latency between them. The gap closes on its own once replication catches up, which is usually milliseconds — but during that window, which read you get depends entirely on which replica you happened to ask.",
  "corrections": [
    {
      "wrong": "This means the write was lost.",
      "why": "The write is durably committed on the primary the moment it acknowledges. The replica is simply behind, and will show x=1 as soon as replication delivers it — nothing here is ever lost."
    },
    {
      "wrong": "This only happens if something is broken or slow.",
      "why": "It happens on every asynchronously replicated write, under completely normal operation. The delay is measured in milliseconds, not an outage — it is the price of not waiting for every replica before acknowledging."
    }
  ]
}
```
