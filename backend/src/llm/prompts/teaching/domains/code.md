---

## This concept is code

A correct answer here is source code, so `tryFirstPrompt` may be a real listing rather than a prose description of one — "you have a variable that increments on click but the screen never updates" becomes an actual four-line component with the bug sitting in it.

### First: does this concept even want one?

**Stop and write `teachBlock: null`, `tryFirstPrompt` as plain prose, unless the concept is a bug, a boundary, or a trace.** A listing is not automatically better than a sentence — most concepts here still don't want one.

1. **Is the whole point something that goes wrong in code?** A stale closure, a missing dependency, an off-by-one, a reference vs. value mixup. → `code`, with the bug present and `tryFirstPrompt` asking what breaks and why.
2. **Is the whole point what a piece of code produces?** A specific output, a specific number of renders, a specific order of calls. → `code`, with `tryFirstPrompt` asking the learner to trace or predict it.
3. **None of the above — the idea is a rule, a trade-off, or a "when would you".** → `teachBlock: null`. "Why memoisation changes the complexity class" and "when you'd reach for a reducer instead of state" are both answered in a sentence; writing a listing for either produces a question about the listing instead of about the idea.

### Second: earn it

Every `code` block needs a `tryFirstPrompt` that could not be asked without it — the test from `system.md` above. If you can write the question with the code removed and it still makes sense, remove the code.

### Hard limits

- **≤8 lines.** This is read once, in about ten seconds, before any teaching has happened — it is not the place for the whole file.
- Runnable, idiomatic code. Never pseudocode, and never `// ...` where the bug or the answer lives.
- `lang` must match whatever language this topic already uses elsewhere (the concept map and item generators already receive the same instruction) — never mix languages within one topic.
- The bug or the traced behaviour must be genuinely present in the listing, not merely implied. A `tryFirstPrompt` asking "what's wrong with this loop" over a loop with nothing wrong with it is unanswerable, and the learner will notice.

### Worked example — concept: "Stale closures in event handlers", `try_first` mode

```json
{
  "tryFirstPrompt": "This button is supposed to always log the current count, but after the first click it logs 0 forever. Why?",
  "teachBlock": {
    "kind": "code",
    "lang": "javascript",
    "src": "function Counter() {\n  const [count, setCount] = useState(0);\n\n  useEffect(() => {\n    const id = setInterval(() => {\n      console.log(count);\n    }, 1000);\n    return () => clearInterval(id);\n  }, []);\n\n  return <button onClick={() => setCount(count + 1)}>{count}</button>;\n}"
  },
  "explanationShort": "The interval's callback closed over `count` from the render where the effect ran — the first one, where `count` is 0 — and the empty dependency array means that effect never runs again to capture a fresher value.",
  "explanationLong": "Every render of `Counter` creates a new `count` variable and a new callback that closes over that specific value. `useEffect` with `[]` runs its setup exactly once, using whichever `count` existed at that first render — 0 — and the interval callback keeps that closure forever, because the effect never re-runs to create a new one. Clicking the button does update `count` and re-render the component, but it does not touch the interval already ticking in the background with its own frozen copy. The fix is either to add `count` to the dependency array (recreating the interval every time it changes) or to read the value through a ref, which the closure can dereference fresh each tick instead of capturing.",
  "corrections": [
    {
      "wrong": "console.log(count) always reads the current value of count, like a live variable.",
      "why": "A closure captures the *value* count had when the function was created, not a live reference to the state. React re-renders create a new count and a new callback each time; the interval's callback is not one of the new ones."
    },
    {
      "wrong": "Removing the dependency array entirely would fix it without side effects.",
      "why": "It would fix the stale value, but at the cost of clearing and recreating the interval on every single render — for a one-second interval that is a new timer roughly every render, not once."
    }
  ]
}
```
