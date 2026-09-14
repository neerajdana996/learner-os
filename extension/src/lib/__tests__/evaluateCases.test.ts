import { describe, expect, it } from 'vitest';
import { evaluateCases } from '../evaluateCases';

/**
 * The sandbox page's evaluator (T-171). It must produce exactly what the web's
 * `runCases` program produces, or the same answer grades differently depending
 * on which surface ran it.
 */
describe('evaluateCases', () => {
  const cases = [
    { name: 'two distinct', call: 'longest("eceba", 2)' },
    { name: 'k too big', call: 'longest("aa", 5)' },
  ];

  it('runs each call against the learner’s declarations', () => {
    const outcome = evaluateCases('function longest(s, k) { return Math.min(s.length, k + 1); }', cases);
    expect(outcome).toEqual({ ok: true, outputs: { 'two distinct': '3', 'k too big': '2' } });
  });

  it('stringifies non-string values the way the web runner does', () => {
    const outcome = evaluateCases('const f = () => [1, 2];', [
      { name: 'array', call: 'f()' },
      { name: 'string', call: '"x"' },
      { name: 'undefined', call: 'undefined' },
    ]);
    expect(outcome).toEqual({ ok: true, outputs: { array: '[1,2]', string: 'x', undefined: 'undefined' } });
  });

  /** One throwing case must not lose the others. */
  it('reports a throwing case as threw, and keeps the rest', () => {
    const outcome = evaluateCases('function longest(s, k) { if (k > 3) throw new Error("big"); return 3; }', cases);
    expect(outcome).toEqual({ ok: true, outputs: { 'two distinct': '3', 'k too big': 'threw: big' } });
  });

  it('reports source that does not parse as an error, not as outputs', () => {
    const outcome = evaluateCases('function longest(s: string) {', cases);
    expect(outcome.ok).toBe(false);
  });
});
