import type { PublicItem } from '@learnos/shared';

/**
 * The landing page's rotating deck (T-156).
 *
 * Two provenances, both real, neither hand-written copy:
 *
 * 1. The first four questions are lifted from this project's own generation
 *    prompts (`backend/src/llm/prompts/items/domains/*.md`) — the worked
 *    examples the model itself is shown, not marketing copy.
 * 2. The "Scaling WebSockets with a relay" questions are verbatim output from
 *    an actual `generateConceptMap` → `generateItems`/`generateTeaching` run
 *    against the live model (2026-09-11), confirming the pipeline produces
 *    real, well-scoped content on a harder topic than the three pilot ones —
 *    not just the hand-reviewed fixtures. The sequence's `svg` is regenerated
 *    from that run's real `lanes`/`messages` through the same `renderSequence`
 *    the worker calls, rather than hand-drawn, so the picture is exactly what
 *    the worker would have stored.
 *
 * A visitor sees the same shapes a real learner does: `QuestionCard` from
 * `@learnos/ui` renders every card here, unmodified.
 *
 * `answer` lives beside the item, never inside it — a `PublicItem` never
 * carries its own answer key (T-010), and a landing-page mock is not an
 * exception worth making. Grading here is purely local: nothing is submitted
 * anywhere, and no session is created.
 */
export interface SampleQuestion {
  item: PublicItem;
  /** `options` index for `recognition`, or the exact accepted string for
   *  `clozeCode`'s one hole. */
  answer: number | string;
  verdict: string;
}

const SVG_UNUSED = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';

// Regenerated via `renderSequence(["Relay","Client"], [...])` from the exact
// lanes/messages a real `generateTeaching` run returned for "Delivery
// guarantees" in "Scaling WebSockets with a relay" (2026-09-11) — see the
// module doc comment.
const DELIVERY_SEQUENCE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 284 120" width="284" height="120" role="img" aria-hidden="true"><defs><marker id="a" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8 z" fill="var(--edge)"/></marker></defs><text x="77" y="16" text-anchor="middle" font-size="11" fill="var(--node-ink)" font-family="IBM Plex Sans, system-ui, sans-serif">Relay</text><line x1="77" y1="24" x2="77" y2="112" stroke="var(--lane)" stroke-width="1"/><text x="207" y="16" text-anchor="middle" font-size="11" fill="var(--node-ink)" font-family="IBM Plex Sans, system-ui, sans-serif">Client</text><line x1="207" y1="24" x2="207" y2="112" stroke="var(--lane)" stroke-width="1"/><line x1="77" y1="34" x2="207" y2="34" stroke="var(--edge)" stroke-width="1.25" marker-end="url(#a)"/><text x="142" y="29" text-anchor="middle" font-size="10" fill="var(--edge)" font-family="IBM Plex Mono, monospace">send message 42</text><line x1="207" y1="68" x2="77" y2="84" stroke="var(--edge-focus)" stroke-width="1.25" stroke-dasharray="4 3" marker-end="url(#a)"/><text x="142" y="63" text-anchor="middle" font-size="10" fill="var(--edge)" font-family="IBM Plex Mono, monospace">message 42 received</text></svg>';

// The exact stale-read example from `items/domains/systems.md` §"Worked
// example" — kept verbatim down to the message order.
const STALE_READ_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 414 222" width="414" height="222" role="img" aria-hidden="true"><defs><marker id="a" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8 z" fill="var(--edge)"/></marker></defs><text x="77" y="16" text-anchor="middle" font-size="11" fill="var(--node-ink)" font-family="IBM Plex Sans, system-ui, sans-serif">Client</text><line x1="77" y1="24" x2="77" y2="214" stroke="var(--lane)" stroke-width="1"/><text x="207" y="16" text-anchor="middle" font-size="11" fill="var(--node-ink)" font-family="IBM Plex Sans, system-ui, sans-serif">Primary</text><line x1="207" y1="24" x2="207" y2="214" stroke="var(--lane)" stroke-width="1"/><text x="337" y="16" text-anchor="middle" font-size="11" fill="var(--node-ink)" font-family="IBM Plex Sans, system-ui, sans-serif">Replica</text><line x1="337" y1="24" x2="337" y2="214" stroke="var(--lane)" stroke-width="1"/><line x1="77" y1="34" x2="207" y2="34" stroke="var(--edge)" stroke-width="1.25" marker-end="url(#a)"/><text x="142" y="29" text-anchor="middle" font-size="10" fill="var(--edge)" font-family="IBM Plex Mono, monospace">write x=1</text><line x1="77" y1="68" x2="337" y2="68" stroke="var(--edge)" stroke-width="1.25" marker-end="url(#a)"/><text x="207" y="63" text-anchor="middle" font-size="10" fill="var(--edge)" font-family="IBM Plex Mono, monospace">read x</text><line x1="337" y1="102" x2="77" y2="102" stroke="var(--edge)" stroke-width="1.25" marker-end="url(#a)"/><text x="207" y="97" text-anchor="middle" font-size="10" fill="var(--edge)" font-family="IBM Plex Mono, monospace">x=0</text><line x1="207" y1="136" x2="337" y2="152" stroke="var(--edge-focus)" stroke-width="1.25" stroke-dasharray="4 3" marker-end="url(#a)"/><text x="272" y="131" text-anchor="middle" font-size="10" fill="var(--edge)" font-family="IBM Plex Mono, monospace">replicate x=1</text></svg>';

export const SAMPLE_QUESTIONS: SampleQuestion[] = [
  // recognition, no block — the original sample, unchanged.
  {
    item: {
      itemId: 'sample-sliding-window',
      conceptId: 'sample-sliding-window-concept',
      type: 'recognition',
      prompt:
        'You are finding the longest substring with no repeated characters. The window has just taken in a character it already contains. What has to happen next?',
      options: [
        'Shrink it from the left until the duplicate is gone',
        'Reset both pointers and start again from the right',
        'Grow it from the right and record the new maximum',
        'Swap the duplicate character out of the string',
      ],
    },
    answer: 0,
    verdict:
      'The invariant is "no repeats inside the window". The moment one appears you shrink from the left until it is gone — growing from the right first would measure a window that is already invalid.',
  },

  // code context + clozeCode answer — from items/domains/code.md's worked example.
  {
    item: {
      itemId: 'sample-binary-search',
      conceptId: 'sample-binary-search-concept',
      type: 'application',
      prompt: 'Complete the loop condition so the last element is still searched.',
      blocks: [
        {
          kind: 'code',
          slot: 'context',
          lang: 'javascript',
          src:
            'function search(a, x) {\n  let lo = 0;\n  let hi = a.length;\n  while (lo < hi) {\n    const mid = (lo + hi) >> 1;\n    if (a[mid] === x) return mid;\n    a[mid] < x ? (lo = mid + 1) : (hi = mid);\n  }\n  return -1;\n}',
          short: undefined,
          notes: [{ line: 3, text: 'one past the end, not the last index' }],
          dim: undefined,
        },
        {
          kind: 'clozeCode',
          slot: 'answer',
          lang: 'javascript',
          src: 'while ({{1}}) {',
          holes: [{ id: 1, width: 8 }],
        },
      ],
    },
    answer: 'lo < hi',
    verdict: 'With `lo <= hi` the loop reads a[a.length] on the last step, which is undefined.',
  },

  // diagram context (rendered via ReactFlow) + recognition answer — the
  // "cache in front of a database" topology systems.md names as the canonical
  // example of a topology question, not a definition question.
  {
    item: {
      itemId: 'sample-cache-topology',
      conceptId: 'sample-cache-topology-concept',
      type: 'recognition',
      prompt: 'The cache is cold and every request currently reads straight from the database. Which arrow disappears once the cache warms up?',
      options: [
        'Client → Cache',
        'Cache → Database',
        'Client → Database',
        'Database → Cache',
      ],
      blocks: [
        {
          kind: 'diagram',
          slot: 'context',
          nodes: [
            { id: 'client', label: 'Client' },
            { id: 'cache', label: 'Cache' },
            { id: 'db', label: 'Database' },
          ],
          edges: [
            { from: 'client', to: 'cache', label: 'read' },
            { from: 'cache', to: 'db', label: 'miss' },
          ],
          alt: 'A client reads from a cache in front of a database; a cache miss falls through to the database.',
          svg: SVG_UNUSED,
        },
      ],
    },
    answer: 2,
    verdict:
      'A cache sits in front of the database, not beside it — the client never talks to the database directly. Once the cache is warm, "miss" is what disappears, not a whole arrow.',
  },

  // sequence context (static SVG, unchanged from the real renderer) +
  // recognition answer — the exact worked example from systems.md.
  {
    item: {
      itemId: 'sample-stale-read',
      conceptId: 'sample-stale-read-concept',
      type: 'recognition',
      prompt: 'The client reads x and gets 0, having just written x=1. Why?',
      options: [
        'The write was lost',
        'The read reached the replica before replication did',
        'The primary rejected the write',
        'The client cached the old value',
      ],
      blocks: [
        {
          kind: 'sequence',
          slot: 'context',
          svg: STALE_READ_SVG,
          alt:
            "A client writes x=1 to the primary, then reads x from the replica and gets 0. The primary's replication of x=1 arrives after the read.",
        },
      ],
    },
    answer: 1,
    verdict:
      "That single delayed arrow is the whole concept: the replica answered the read honestly, from data that simply hadn't arrived yet.",
  },

  // Real model output (2026-09-11) — recognition, no block. From an actual
  // `generateItems` call for "Fan-out load" in "Scaling WebSockets with a
  // relay". See the module doc comment.
  {
    item: {
      itemId: 'sample-fanout-load',
      conceptId: 'sample-fanout-load-concept',
      type: 'recognition',
      prompt:
        'A relay receives 40 messages per second, each sent to 25 sockets on average. What is the expected fan-out load?',
      options: [
        '1,600 socket sends per second',
        '400 socket sends per second',
        '1,000 socket sends per second',
        '100 socket sends per second',
      ],
    },
    answer: 2,
    verdict:
      'Fan-out load is message rate × average recipient sockets per message: 40 × 25 = 1,000 socket sends per second — the number the relay actually has to sustain, not the 40 it receives.',
  },

  // Real model output (2026-09-11) — recognition, no block. From the same run,
  // concept "Connection ownership".
  {
    item: {
      itemId: 'sample-connection-ownership',
      conceptId: 'sample-connection-ownership-concept',
      type: 'recognition',
      prompt: 'A relay receives a message for a live WebSocket. Which fact determines where it sends the message?',
      options: [
        'The instance selected by the relay randomly',
        'The instance that handled the latest message',
        'The instance with the fewest active connections',
        'The instance that accepted the WebSocket',
      ],
    },
    answer: 3,
    verdict:
      'Each live WebSocket stays with the instance that accepted it — no other instance can write to that exact socket, so the relay has to route to the owner, not just any instance.',
  },

  // Real model output (2026-09-11), composed from two calls on the same
  // concept ("Delivery guarantees"): the recognition item from a real
  // `generateItems` run, paired with the sequence context from a real
  // `generateTeaching` run for the same concept and topic — see the module
  // doc comment for why these are two calls rather than one.
  {
    item: {
      itemId: 'sample-delivery-guarantees',
      conceptId: 'sample-delivery-guarantees-concept',
      type: 'recognition',
      prompt: 'What does at-most-once delivery allow when a relay fails?',
      options: [
        'The message is delivered twice before the relay confirms receipt',
        'The message is delivered again, but it is never lost',
        'The message is delivered once after the relay recovers',
        'The message may be lost, but it is not delivered again',
      ],
      blocks: [
        {
          kind: 'sequence',
          slot: 'context',
          svg: DELIVERY_SEQUENCE_SVG,
          alt:
            "The relay sends message 42. The client's receipt confirmation is delayed or lost, so the relay cannot tell whether the client received it.",
        },
      ],
    },
    answer: 3,
    verdict:
      'A relay may lose a message or send it more than once, depending on when a crash or network failure happens. At-most-once means the failure mode is loss, never duplication.',
  },
];
