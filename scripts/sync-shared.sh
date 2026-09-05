#!/usr/bin/env bash
# Copies the two source-of-truth folders into the projects that consume them.
# Neither copy is ever edited by hand (plan.md §5).
#
#   backend/src/shared  →  frontend/src/shared      the API contract: Zod + types
#   shared-ui           →  frontend/src/shared-ui   presentation: tokens, mixins,
#                          extension/src/shared-ui  and (from T-085) pure renderers
#
#   scripts/sync-shared.sh          sync, then verify → "✅ shared in sync"
#   scripts/sync-shared.sh --check  verify only; exit 1 and report drift (CI / pre-commit)
#
# Why a copy and not a package (T-090): a package buys per-project version
# pinning, and version independence is the opposite of what is wanted here —
# drift between the web app and the extension IS the failure mode. `diff -r`
# makes divergence impossible rather than merely discouraged, and three plain
# projects stay three plain projects.
set -euo pipefail
cd "$(dirname "$0")/.."

MODE=${1:-sync}

# source:target,target
PAIRS=(
  "backend/src/shared:frontend/src/shared,extension/src/shared"
  "shared-ui:frontend/src/shared-ui,extension/src/shared-ui"
)

targets_for() { echo "${1#*:}" | tr ',' ' '; }
source_of()   { echo "${1%%:*}"; }

# Guard 1: everything synced must be browser-safe — it is compiled by Vite for
# the web app and by WXT for the extension, neither of which has Node.
guard_browser_safe() {
  local src=$1
  if grep -rEn --include='*.ts' --include='*.tsx' --exclude='*.test.ts' --exclude='*.test.tsx' \
      --exclude-dir='__tests__' "from ['\"](node:|drizzle|postgres|bullmq|ioredis|express|ws)" "$src"; then
    echo "❌ $src contains Node-only imports — not browser-safe" >&2
    return 1
  fi
}

# Guard 2: a synced folder may not reach outside itself. It lands at a different
# depth in each project, so any escaping path resolves somewhere different (or
# nowhere) on the other side — and the failure shows up as a build error in the
# project nobody was working in.
#
# `../../` is the shortest path out of a one-level subdirectory, which is as deep
# as these folders go; a project name in a path is the other way people write it.
guard_self_contained() {
  local src=$1
  if grep -rEn --include='*.scss' --include='*.css' "@(use|import)[^;]*\.\./\.\./" "$src"; then
    echo "❌ $src has a stylesheet reaching outside the shared folder" >&2
    return 1
  fi
  if grep -rEn --include='*.scss' --include='*.css' --include='*.ts' --include='*.tsx' \
      "['\"][^'\"]*(frontend|extension|backend)/" "$src"; then
    echo "❌ $src references a project by name — it must not know who consumes it" >&2
    return 1
  fi
}

copy() {
  local src=$1 target=$2
  mkdir -p "$target"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete --exclude='*.test.ts' --exclude='*.test.tsx' --exclude='__tests__/' "$src/" "$target/"
  else
    rm -rf "$target" && mkdir -p "$target"
    (cd "$src" && find . -type f ! -name '*.test.ts' ! -name '*.test.tsx' ! -path './__tests__/*' \
      -exec sh -c 'mkdir -p "$0/$(dirname "$1")" && cp "$1" "$0/$1"' "$OLDPWD/$target" {} \;)
  fi
}

verify() {
  local ok=0 pair src
  for pair in "${PAIRS[@]}"; do
    src=$(source_of "$pair")
    for target in $(targets_for "$pair"); do
      if ! diff -r -x '*.test.ts' -x '*.test.tsx' -x '__tests__' "$src" "$target" >/dev/null 2>&1; then
        echo "❌ drift: $target differs from $src" >&2
        diff -r -x '*.test.ts' -x '*.test.tsx' -x '__tests__' "$src" "$target" >&2 || true
        ok=1
      fi
    done
  done
  return $ok
}

for pair in "${PAIRS[@]}"; do
  src=$(source_of "$pair")
  guard_browser_safe "$src"
  guard_self_contained "$src"
done

case "$MODE" in
  --check)
    if verify; then echo "✅ shared in sync"; else echo "   run scripts/sync-shared.sh to fix" >&2; exit 1; fi
    ;;
  sync)
    for pair in "${PAIRS[@]}"; do
      src=$(source_of "$pair")
      for target in $(targets_for "$pair"); do copy "$src" "$target"; done
    done
    verify && echo "✅ shared in sync"
    ;;
  *)
    echo "usage: $0 [--check]" >&2; exit 2
    ;;
esac
