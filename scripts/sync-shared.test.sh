#!/usr/bin/env bash
# Test for sync-shared.sh (T-001):
#   1. modify a synced copy → `--check` exits non-zero and reports drift
#   2. run sync → exit 0 and copies are identical
# Works on a temp copy of the repo so it never touches your working tree.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/scripts"
cp "$ROOT/scripts/sync-shared.sh" "$TMP/scripts/"
cp -R "$ROOT/backend" "$TMP/backend" 2>/dev/null || { mkdir -p "$TMP/backend/src"; cp -R "$ROOT/backend/src" "$TMP/backend/src"; }
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
diff -r -x '*.test.ts' backend/src/shared frontend/src/shared >/dev/null || fail "frontend copy still differs after sync"
diff -r -x '*.test.ts' backend/src/shared extension/src/shared >/dev/null || fail "extension copy still differs after sync"

# test files must not be synced
[ ! -e frontend/src/shared/index.test.ts ] || fail "*.test.ts leaked into synced copy"

# node-only import guard
echo "import { x } from 'node:fs';" > backend/src/shared/bad.ts
if bash scripts/sync-shared.sh >/dev/null 2>&1; then
  fail "sync should refuse Node-only imports in shared"
fi

echo "✅ sync-shared.test.sh passed"
