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

## See and test everything

```bash
cp backend/.env.example backend/.env   # OPENAI_API_KEY — only needed to generate a topic
docker compose up --build -d           # postgres, redis, backend :3001, frontend :3000
docker compose exec backend pnpm seed  # a usable dataset: no API key, no waiting
open http://localhost:3000             # "Sign in as dev@learnos.local" — the dev-only button
```

That gives you a signed-in learner with a 23-concept topic, 5 concepts already
taught and 4 reviews due, so **Today's session** and the **Map** have something
in them immediately. Without the seed you would have to generate a topic (about
nine minutes and $0.46) and then wait out a thirty-day schedule to see a review.

**The extension is built, not served** — a Chrome extension has to be loaded by
the browser, so it can't be a compose service. It is behind a `build` profile:

```bash
docker compose run --rm extension              # → extension/dist/chrome-mv3 + a .zip
```

Then `chrome://extensions` → Developer mode → **Load unpacked** →
`extension/dist/chrome-mv3`. Click the icon → **Connect**, and paste an
extension token — `pnpm seed` prints one, or mint your own:

```bash
curl -X POST http://localhost:3001/auth/extension-token -H "x-user-id: <dev user id>"
```

### Resetting and looking inside

```bash
docker compose exec backend pnpm seed                # reset to a clean dataset, any time
docker compose exec backend pnpm preflight           # check the LIVE environment, not the mocks
docker compose exec backend pnpm qa <topicId>        # every concept, item and answer key, to a file
docker compose logs -f backend                       # generation progress and per-topic cost
```

`pnpm seed` is safe to re-run after you have used the app — it clears the
learner's answers along with their topic. It refuses any database that isn't
local.

Signing in with a password only works outside production: the route is not
registered under `NODE_ENV=production`, and the button is compiled out of the
production bundle.

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
