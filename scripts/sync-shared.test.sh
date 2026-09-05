#!/usr/bin/env bash
# Test for sync-shared.sh (T-001, extended by T-090):
#   1. modify a synced copy → `--check` exits non-zero and reports drift
#   2. run sync → exit 0 and copies are identical
#   3. both source folders — the contract and the presentation one — behave the same
#   4. the guards refuse what would break a consumer's build
# Works on a temp copy of the repo so it never touches your working tree.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/scripts"
cp "$ROOT/scripts/sync-shared.sh" "$TMP/scripts/"
cp -R "$ROOT/backend" "$TMP/backend" 2>/dev/null || { mkdir -p "$TMP/backend/src"; cp -R "$ROOT/backend/src" "$TMP/backend/src"; }
cp -R "$ROOT/shared-ui" "$TMP/shared-ui"
mkdir -p "$TMP/frontend/src" "$TMP/extension/src"
rm -rf "$TMP/backend/node_modules"

fail() { echo "❌ $1" >&2; exit 1; }

cd "$TMP"

# baseline sync must succeed
bash scripts/sync-shared.sh >/dev/null || fail "initial sync failed"
bash scripts/sync-shared.sh --check >/dev/null || fail "--check should pass right after sync"

# introduce drift in a synced copy
echo "// hand edit — not allowed" >> frontend/src/shared/index.ts
if bash scripts/sync-shared.sh --check >/dev/null 2>"$TMP/err"; then
  fail "--check should exit non-zero on drift"
fi
grep -q "drift: frontend/src/shared" "$TMP/err" || fail "--check should report which copy drifted"

# sync fixes it
bash scripts/sync-shared.sh >/dev/null || fail "sync should exit 0"
diff -r -x '*.test.ts' -x '__tests__' backend/src/shared frontend/src/shared >/dev/null || fail "frontend copy still differs after sync"
diff -r -x '*.test.ts' -x '__tests__' backend/src/shared extension/src/shared >/dev/null || fail "extension copy still differs after sync"

# tests must not be synced, in either layout
[ ! -e frontend/src/shared/index.test.ts ] || fail "*.test.ts leaked into synced copy"
[ ! -e frontend/src/shared/__tests__ ] || fail "__tests__/ leaked into synced copy"
[ ! -e extension/src/shared/__tests__ ] || fail "__tests__/ leaked into synced copy"

# --- T-090: the presentation folder rides the same rails ---
diff -r shared-ui frontend/src/shared-ui >/dev/null || fail "frontend shared-ui copy differs after sync"
diff -r shared-ui extension/src/shared-ui >/dev/null || fail "extension shared-ui copy differs after sync"
grep -q -- "--clay" extension/src/shared-ui/styles/_themes.scss || fail "tokens did not reach the extension"

echo "// hand edit" >> extension/src/shared-ui/styles/_variables.scss
if bash scripts/sync-shared.sh --check >/dev/null 2>"$TMP/err2"; then
  fail "--check should exit non-zero on shared-ui drift"
fi
grep -q "drift: extension/src/shared-ui" "$TMP/err2" || fail "--check should name the drifted shared-ui copy"
bash scripts/sync-shared.sh >/dev/null || fail "sync should repair shared-ui drift"

# --- guards ---
# A stylesheet reaching out of the folder resolves to a different place in each
# project, because shared-ui lands at a different depth in both.
echo '@use "../../frontend/src/styles/base";' > shared-ui/styles/_escape.scss
if bash scripts/sync-shared.sh >/dev/null 2>&1; then
  fail "sync should refuse a stylesheet reaching outside shared-ui"
fi
rm shared-ui/styles/_escape.scss

# Naming a project is the other way people write the same mistake.
echo '@use "frontend/src/styles/base";' > shared-ui/styles/_named.scss
if bash scripts/sync-shared.sh >/dev/null 2>&1; then
  fail "sync should refuse a shared-ui file that names a consuming project"
fi
rm shared-ui/styles/_named.scss

# A sibling @use is the normal case and must still be allowed.
bash scripts/sync-shared.sh >/dev/null || fail "sync should accept shared-ui after the bad files are gone"

# node-only import guard (regression — the contract folder still enforces it)
echo "import { x } from 'node:fs';" > backend/src/shared/bad.ts
if bash scripts/sync-shared.sh >/dev/null 2>&1; then
  fail "sync should refuse Node-only imports in shared"
fi

echo "✅ sync-shared.test.sh passed"
