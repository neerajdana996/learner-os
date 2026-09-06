#!/usr/bin/env bash
# One-shot verification of T-001 acceptance criteria. Run from a machine with
# node ≥ 20, pnpm, and docker. Stops at the first failure.
#
#   scripts/verify.sh            everything (projects + docker compose)
#   scripts/verify.sh --no-docker  skip the compose step
set -euo pipefail
cd "$(dirname "$0")/.."
NO_DOCKER=0; [ "${1:-}" = "--no-docker" ] && NO_DOCKER=1

step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }

step "install the workspace (one lockfile, all five packages)"
pnpm install --frozen-lockfile

step "packages/shared: build, lint, test"
pnpm --filter @learnos/shared build
pnpm --filter @learnos/shared lint
pnpm --filter @learnos/shared test

for p in backend frontend extension; do
  step "$p: pnpm lint && pnpm test"
  ( cd "$p" && pnpm lint && pnpm test )
done

# `pnpm lint` is `tsc --noEmit` in both client projects and never compiles a
# stylesheet, so a broken `@use` path — the exact failure mode `shared-ui`
# introduces (T-090) — passes lint and fails only at build.
for p in frontend extension; do
  step "$p: pnpm build (proves every @use path resolves)"
  ( cd "$p" && pnpm build )
done

step "@learnos/shared contains no Node-only imports"
! grep -rEn "from ['\"](node:|drizzle|postgres|bullmq|ioredis|express|ws)['\"/]" packages/shared/src

# The suite mocks the model SDK, never reads .env and only touches the test
# database, so a green suite has repeatedly coexisted with an app that would
# not start. Preflight is the part that talks to the real environment; without
# it, schema drift between schema.ts and a live database goes unnoticed until
# it surfaces as an unrelated 500 at runtime.
step "backend preflight (live env: schema drift, redis, mail, model)"
( cd backend && pnpm preflight )

if [ "$NO_DOCKER" = 1 ]; then echo; echo "✅ all project checks passed (docker skipped)"; exit 0; fi

step "docker compose up --build"
[ -f backend/.env ] || cp backend/.env.example backend/.env
docker compose up --build -d
trap 'docker compose logs --tail=50 backend frontend >&2 || true' ERR

step "wait for backend /health"
for i in $(seq 1 60); do
  if curl -fsS localhost:3001/health 2>/dev/null | grep -q '"ok":true'; then break; fi
  sleep 2; [ "$i" = 60 ] && { echo "backend never became healthy" >&2; exit 1; }
done
curl -fsS localhost:3001/health; echo

step "frontend serves the app and proxies /api"
curl -fsS localhost:3000/ | grep -q '<div id="root">'
curl -fsS localhost:3000/api/health | grep -q '"ok":true'

step "learnos_test database exists"
docker compose exec -T postgres psql -U learnos -d learnos_test -c 'select 1' >/dev/null

echo; echo "✅ T-001 verified. Stop with: docker compose down"
