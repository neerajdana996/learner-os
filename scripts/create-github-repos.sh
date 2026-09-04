#!/usr/bin/env bash
# Creates the four learnos GitHub repos under your account and pushes them:
#
#   learner-os            ← this folder (docs, compose, scripts; project dirs git-ignored)
#   learner-os-backend    ← backend/
#   learner-os-frontend   ← frontend/
#   learner-os-extension  ← extension/
#
# Requirements: git, gh (`gh auth login` done). Idempotent: re-running skips
# repos that already exist and only pushes new commits.
#
#   scripts/create-github-repos.sh                 private repos, owner = gh user
#   scripts/create-github-repos.sh --public
#   OWNER=my-org scripts/create-github-repos.sh    create under an org
#   PREFIX=learner-os scripts/create-github-repos.sh
#   DRY_RUN=1 scripts/create-github-repos.sh       print what would happen
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

VISIBILITY="--private"; [ "${1:-}" = "--public" ] && VISIBILITY="--public"
PREFIX="${PREFIX:-learner-os}"
BRANCH="${BRANCH:-main}"
DRY_RUN="${DRY_RUN:-0}"

command -v gh  >/dev/null || { echo "gh CLI not found — https://cli.github.com" >&2; exit 1; }
command -v git >/dev/null || { echo "git not found" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "not logged in — run: gh auth login" >&2; exit 1; }

OWNER="${OWNER:-$(gh api user -q .login)}"
echo "owner: $OWNER   prefix: $PREFIX   visibility: ${VISIBILITY#--}   branch: $BRANCH"

run() { if [ "$DRY_RUN" = 1 ]; then echo "  [dry-run] $*"; else "$@"; fi; }

# ensure_repo <dir> <repo-name> <description>
ensure_repo() {
  local dir=$1 name=$2 desc=$3 full="$OWNER/$name"
  echo
  echo "▶ $full  ($dir)"
  cd "$ROOT/$dir"

  if [ ! -d .git ]; then
    run git init -b "$BRANCH" -q
  fi

  # Ensure the branch name matches (older git may init as master)
  local cur; cur="$(git symbolic-ref --short HEAD 2>/dev/null || echo "$BRANCH")"
  [ "$cur" = "$BRANCH" ] || run git branch -M "$BRANCH"

  run git add -A
  if ! git diff --cached --quiet 2>/dev/null || [ "$DRY_RUN" = 1 ]; then
    if git rev-parse --verify HEAD >/dev/null 2>&1; then
      run git commit -q -m "chore: sync from learnos T-001 bootstrap"
    else
      run git commit -q -m "T-001: three-project bootstrap, Docker, shared-sync

Deps (backend): express (HTTP API), ws (WebSocket push), cors, zod (shared schemas),
drizzle-orm + postgres + drizzle-kit (DB), bullmq + ioredis (jobs), ts-fsrs (scheduler),
@anthropic-ai/sdk (generator), tsx, typescript, vitest, supertest, cross-env.
Deps (frontend): react, react-dom, react-router-dom, @reduxjs/toolkit + react-redux
(RTK Query for all API calls + state), zod, vite, @vitejs/plugin-react, vitest,
@testing-library/react + jest-dom, jsdom, typescript.
Deps (extension): wxt + @wxt-dev/module-react (MV3 build), react, react-dom, zod,
typescript, vitest."
    fi
  else
    echo "  nothing to commit"
  fi

  if gh repo view "$full" >/dev/null 2>&1; then
    echo "  repo exists"
  else
    run gh repo create "$full" $VISIBILITY --description "$desc" --disable-wiki
  fi

  local url="https://github.com/$full.git"
  if git remote get-url origin >/dev/null 2>&1; then
    run git remote set-url origin "$url"
  else
    run git remote add origin "$url"
  fi

  run git push -u origin "$BRANCH"
  cd "$ROOT"
}

ensure_repo backend   "$PREFIX-backend"   "learnos API — Express + ws + Drizzle + BullMQ"
ensure_repo frontend  "$PREFIX-frontend"  "learnos web app — React + Vite + Redux Toolkit/RTK Query"
ensure_repo extension "$PREFIX-extension" "learnos Chrome extension — WXT + React (MV3)"
ensure_repo .         "$PREFIX"           "learnos — docs, docker-compose and scripts (umbrella repo)"

echo
echo "✅ done:"
for n in "$PREFIX-backend" "$PREFIX-frontend" "$PREFIX-extension" "$PREFIX"; do
  echo "   https://github.com/$OWNER/$n"
done
