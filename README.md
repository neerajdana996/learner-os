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
The project folders are git-ignored here and live in their own repos, so cloning
this repo alone gets you docs and compose but no code — you need all four:

```bash
git clone git@github.com:neerajdana996/learner-os.git && cd learner-os
git clone git@github.com:neerajdana996/learner-os-backend.git   backend
git clone git@github.com:neerajdana996/learner-os-frontend.git  frontend
git clone git@github.com:neerajdana996/learner-os-extension.git extension
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
Start Postgres first — the per-project `pnpm test` step runs *before* the script
brings compose up, and the backend's DB tests need a live `learnos_test`:

```bash
docker compose up postgres redis -d
cd backend && pnpm db:test:push && cd ..   # first run only, or after a schema change

scripts/verify.sh              # sync test → lint+test ×3 → docker compose up → health checks
scripts/verify.sh --no-docker
```

## Shared code
Edit only `backend/src/shared/`, then `scripts/sync-shared.sh`. `scripts/sync-shared.sh --check` fails on drift.

## GitHub repos
All four are private under [`neerajdana996`](https://github.com/neerajdana996):

| Folder | Repo |
| --- | --- |
| `.` (this one) | [learner-os](https://github.com/neerajdana996/learner-os) |
| `backend/` | [learner-os-backend](https://github.com/neerajdana996/learner-os-backend) |
| `frontend/` | [learner-os-frontend](https://github.com/neerajdana996/learner-os-frontend) |
| `extension/` | [learner-os-extension](https://github.com/neerajdana996/learner-os-extension) |

Each tracks `origin/main`, so day to day it's just `git push` in whichever folder you changed.
`scripts/create-github-repos.sh` re-creates the set under a different account (needs `gh auth login`).

## Working with an AI agent
Open Claude Code in this folder: `claude` → "Read CLAUDE.md and start."
