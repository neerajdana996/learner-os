#!/usr/bin/env bash
# Copies backend/src/shared → frontend/src/shared and extension/src/shared.
# backend is the ONLY place shared code is edited (plan.md §5).
#
#   scripts/sync-shared.sh          sync, then verify → "✅ shared in sync"
#   scripts/sync-shared.sh --check  verify only; exit 1 and report drift (CI / pre-commit)
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=backend/src/shared
TARGETS=(frontend/src/shared extension/src/shared)
MODE=${1:-sync}

# Guard: shared must be browser-safe. Tests stay in backend only — both the
# `*.test.ts` naming and the `__tests__/` directory layout.
if grep -rEn --include='*.ts' --exclude='*.test.ts' --exclude-dir='__tests__' "from ['\"](node:|drizzle|postgres|bullmq|ioredis|express|ws)" "$SRC"; then
  echo "❌ $SRC contains Node-only imports — not browser-safe" >&2
  exit 1
fi

copy() {
  local target=$1
  mkdir -p "$target"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete --exclude='*.test.ts' --exclude='__tests__/' "$SRC/" "$target/"
  else
    rm -rf "$target" && mkdir -p "$target"
    (cd "$SRC" && find . -type f ! -name '*.test.ts' ! -path './__tests__/*' -exec sh -c 'mkdir -p "$0/$(dirname "$1")" && cp "$1" "$0/$1"' "$OLDPWD/$target" {} \;)
  fi
}

verify() {
  local ok=0
  for target in "${TARGETS[@]}"; do
    if ! diff -r -x '*.test.ts' -x '__tests__' "$SRC" "$target" >/dev/null 2>&1; then
      echo "❌ drift: $target differs from $SRC" >&2
      diff -r -x '*.test.ts' -x '__tests__' "$SRC" "$target" >&2 || true
      ok=1
    fi
  done
  return $ok
}

case "$MODE" in
  --check)
    if verify; then echo "✅ shared in sync"; else echo "   run scripts/sync-shared.sh to fix" >&2; exit 1; fi
    ;;
  sync)
    for target in "${TARGETS[@]}"; do copy "$target"; done
    verify && echo "✅ shared in sync"
    ;;
  *)
    echo "usage: $0 [--check]" >&2; exit 2
    ;;
esac
