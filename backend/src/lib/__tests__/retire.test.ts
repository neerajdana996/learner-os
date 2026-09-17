import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isRetired, RETIRED_FLAG_THRESHOLD } from '../retire.js';

/**
 * One rule, one place (T-062).
 *
 * `qa:retire` used to be honoured by two of the five queries that pick an item:
 * `/due` and the cold test's candidates. The session's retrieval item and the
 * diagnostic's per-concept item each read straight from the table, so a
 * question the founder had rejected as wrong was still taught with, still
 * asked, and — through the test generator — scoreable on day 30.
 *
 * The comparison now lives in `lib/retire.ts` and every caller uses
 * `notRetired()` or `isRetired()`. This test is what keeps it that way: a new
 * query that writes the threshold out again fails here, naming the file.
 */
const SRC = resolve(new URL('../../', import.meta.url).pathname);

/** `qa.ts` is the one place that *writes* the threshold — `qa:retire` raises
 *  `flagged_bad` to it. That is the rule's source, not a second copy of it. */
const ALLOWED = ['lib/retire.ts', 'scripts/qa.ts'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') && !full.endsWith('.test.ts') ? [full] : [];
  });
}

describe('the retire threshold', () => {
  it('is compared in exactly one place', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => readFileSync(file, 'utf8').includes('RETIRED_FLAG_THRESHOLD'))
      .map((file) => relative(SRC, file))
      .filter((file) => !ALLOWED.includes(file));

    expect(offenders).toEqual([]);
  });

  it('retires at the threshold, not before', () => {
    expect(isRetired(RETIRED_FLAG_THRESHOLD - 1)).toBe(false);
    expect(isRetired(RETIRED_FLAG_THRESHOLD)).toBe(true);
    expect(isRetired(RETIRED_FLAG_THRESHOLD + 5)).toBe(true);
  });
});
