# learnos

Three independent projects + docker compose. Four GitHub repos:

```
learner-os/            ← this repo: docs, docker-compose, scripts (project folders are git-ignored)
├── backend/           learner-os-backend    Express + ws + Drizzle + BullMQ   :3001
├── frontend/          learner-os-frontend   React + Vite + Redux Toolkit/RTK Query (nginx) :3000
├── extension/         learner-os-extension  WXT Chrome extension (build only)
└── docs/              plan.md · loop.md · sprint.md · tasks.md
```

## Fresh clone
```bash
git clone git@github.com:<you>/learner-os.git && cd learner-os
git clone git@github.com:<you>/learner-os-backend.git   backend
git clone git@github.com:<you>/learner-os-frontend.git  frontend
git clone git@github.com:<you>/learner-os-extension.git extension
```

## Start everything
```bash
cp backend/.env.example backend/.env   # add ANTHROPIC_API_KEY
docker compose up --build              # postgres, redis, backend (/health), frontend (:3000)
docker compose run --rm extension      # optional: build the extension zip into extension/dist
```

## Develop one project
```bash
docker compose up postgres redis -d
cd backend  && pnpm install && pnpm dev     # :3001, ws at /ws
cd frontend && pnpm install && pnpm dev     # :5173, /api + /ws proxied to :3001
cd extension && pnpm install && pnpm dev    # opens Chrome with the extension
```

## Verify (T-001 acceptance)
```bash
scripts/verify.sh              # sync test → lint+test ×3 → docker compose up → health checks
scripts/verify.sh --no-docker
```

## Shared code
Edit only `backend/src/shared/`, then `scripts/sync-shared.sh`. `scripts/sync-shared.sh --check` fails on drift.

## GitHub repos
`scripts/create-github-repos.sh` creates the four repos under your account (needs `gh auth login`) and pushes.

## Working with an AI agent
Open Claude Code in this folder: `claude` → "Read CLAUDE.md and start."
