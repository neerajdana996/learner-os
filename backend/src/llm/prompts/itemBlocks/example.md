Concept: *"Exclusive upper bound in binary search"* — the window is half-open, so `hi` is the first index not yet searched and the loop compares with `<`.

Its six existing questions:

```
1. [recall] In a binary search written with an exclusive upper bound, what does `hi` hold when the search starts?
2. [application] Complete the loop condition so the last element is still searched.
3. [recall] Why is `hi` initialised to `a.length` rather than `a.length - 1`?
4. [application] This search never terminates when the target is missing. Which line has to change?
5. [explain] A colleague writes a sliding window with `while (right <= n)` and it reads one element past the end. Explain the shared idea.
6. [recall] What invariant does the loop maintain between iterations?
```

One upgrade, not two:

```json
{
  "upgrades": [
    {
      "replaces": 2,
      "item": {
        "type": "application",
        "prompt": "Complete the loop condition so the last element is still searched.",
        "answer": "lo < hi",
        "accept": ["lo<hi"],
        "isTransfer": false,
        "blocks": [
          { "kind": "code", "slot": "context", "lang": "javascript", "src": "function search(a, x) {\n  let lo = 0;\n  let hi = a.length;\n  while (lo < hi) {\n    const mid = (lo + hi) >> 1;\n    if (a[mid] === x) return mid;\n    a[mid] < x ? (lo = mid + 1) : (hi = mid);\n  }\n  return -1;\n}", "short": null, "notes": [{ "lineQuote": "let hi = a.length;", "text": "one past the end, not the last index" }], "dim": null },
          { "kind": "clozeCode", "slot": "answer", "lang": "javascript", "src": "while ({{1}}) {", "holes": [{ "id": 1, "answer": "lo < hi", "accept": ["lo<hi"], "width": 8 }], "failure": "With `lo <= hi` the loop reads a[a.length] on the last step, which is undefined." }
        ]
      }
    }
  ]
}
```

**Why only item 2.** It is rule-with-a-boundary, list entry 1, and the blank sits *on* the boundary — so `failure` writes itself and getting it wrong is exactly the misconception. Item 4 is a genuine failure mode and would have made a fair `hotspotLine`, but the cap is a time budget and this concept does not need two code questions to be learned; when two qualify, take the one whose wrong answer is most diagnostic.

**Why the other four were left alone.** Items 1, 3 and 6 are answered in a sentence — a listing would ask about the picture instead of the idea. Item 5 is an `explain`, and an explain item already has its answer surface; a blank cannot be cut into a rubric.

**What the upgrade kept.** Same `type`, same `isTransfer`, same question about the same thing. The prompt still reads correctly to someone who cannot see the listing, which is what the extension and a screen reader get.
