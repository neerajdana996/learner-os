# deploy.md — how Cold Recall ships

> The app side of deployment (T-048). The machine it runs on — the EC2 host,
> DNS, backups — is Terraform, documented in [`infra/README.md`](../infra/README.md).
> No secret appears in this file, and none should ever be added to it.

## The shape

One EC2 machine runs [Coolify](https://coolify.io), and Coolify runs everything
else. Dashboard: **https://deploy.coldrecall.info** (project `coldrecall`,
environment `production`).

| app | serves | built from | port | Coolify health check |
| --- | --- | --- | --- | --- |
| `backend` | `https://api.coldrecall.info` — the API and all three workers, one process | `backend/Dockerfile` | 3001 | `GET /health` |
| `frontend` | `https://coldrecall.info` (and `www`, redirected to it) — static files behind nginx | `frontend/Dockerfile` | 80 | `GET /` |
| `postgres` | Postgres 16, reachable only inside Coolify's network | Coolify-managed | 5432 | — |
| `redis` | Redis 7, reachable only inside Coolify's network | Coolify-managed | 6379 | — |

The Chrome extension is **not** deployed by Coolify — see
[The Chrome extension](#the-chrome-extension).

## Deploying is pushing to `main`

There is no deploy command. Both apps are connected to the repository through
the `coldrecall-git` GitHub App with auto-deploy on:

1. A commit lands on `main`.
2. Coolify compares the changed paths with each app's **watch paths** and
   rebuilds only the apps that match.
3. It builds that app's Dockerfile from the repository root.
4. The backend container runs `pnpm drizzle-kit push` (brings the database
   schema up to `schema.ts`) and only then starts the server.
5. Coolify waits for the health check to pass, then moves traffic to the new
   container.

**What rebuilds what:**

| a change under | rebuilds |
| --- | --- |
| `backend/**` | backend |
| `frontend/**` | frontend |
| `packages/shared/**` | backend **and** frontend |
| `packages/ui/**` | frontend |
| `pnpm-lock.yaml` | backend **and** frontend |
| `docs/`, `infra/`, `e2e/`, `extension/` | nothing |

**Before pushing:** `pnpm check` from the repository root (lint, every test
suite, every build) — `pnpm lint` alone never compiles SCSS. For a change a
learner can see, also `pnpm e2e`. Pushing is deploying: nothing sits between a
green local run and production.

## Checking a deploy

The frontend is usually live a minute or two after the push; the backend takes
several minutes, because its image builds the whole workspace. The Coolify
dashboard lists each deployment with its commit and status.

```bash
curl -s https://api.coldrecall.info/health
```

`{"ok":true}` — the process is up. This is what Coolify restarts on, so it
deliberately checks nothing else.

```bash
curl -s https://api.coldrecall.info/health/ready
```

`{"ok":true,"checks":{"postgres":"ok","redis":"ok"}}` with a 200 — the backend
can actually reach its database and Redis. A 503 names which one is `down`.
**This is the check that tells you the product works**; `/health` stayed green
through a total database outage on 2026-09-13.

```bash
curl -sI https://api.coldrecall.info/health/ready | grep -i x-request-id
```

A request id on every response means the logging from T-047 is in the running
build.

If DNS changed recently, measure against the host directly so a stale resolver
cache cannot mislead you: add `--resolve api.coldrecall.info:443:13.204.7.173`
to any of these.

## Settings and secrets

All of them live in Coolify: `coldrecall` → `production` → the app →
**Environment Variables**. None are in the repository. `backend/.env` is the
local development copy and is gitignored.

**Backend**

| variable | kind | set by |
| --- | --- | --- |
| `NODE_ENV` (`production`), `PORT`, `APP_URL`, `API_URL`, `CORS_ORIGINS`, `LLM_PROVIDER`, `ADMIN_EMAILS` | setting | `infra/coolify/bootstrap.py` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `MAIL_FROM`, `GITHUB_CLIENT_ID`, `GOOGLE_CLIENT_ID` | setting | `bootstrap.py`, copied from `backend/.env` |
| `DATABASE_URL`, `REDIS_URL` | **secret** | `infra/coolify/set-secrets.py`, read from Coolify's own internal URLs (`DATABASE_URL` carries `sslmode=require`) |
| `OPENAI_API_KEY`, `SMTP_PASS`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_SECRET` | **secret** | `set-secrets.py`, read from `backend/.env` |
| `EXTENSION_ORIGINS` | setting | **unset today** — see [the extension](#the-chrome-extension) |

Left at their defaults in production: `AUTH_TOKEN_TTL_MIN` (15),
`SESSION_TTL_DAYS` (30), `LLM_BASE_URL`, `GOOGLE_CLOUD_PROJECT`,
`GOOGLE_CLOUD_LOCATION`. `DEV_LOGIN_EMAIL` and `DEV_LOGIN_PASSWORD` are unused
in production, because `NODE_ENV=production` removes the dev routes — which is
why that one variable matters more than the rest.

**Frontend**

| variable | kind | set by |
| --- | --- | --- |
| `VITE_API_URL` (`https://api.coldrecall.info`) | setting, **build-time** | `bootstrap.py` |

`VITE_API_URL` is baked into the JavaScript when the image builds, so changing
it needs a rebuild, not a restart.

**Changing a setting:** edit it in Coolify, then redeploy that app. A running
container never sees a new value.

**Rotating a secret** (the founder does this; tooling never sets secrets):

1. Put the new value in `backend/.env`.
2. Open the tunnel to Coolify's API:
   ```bash
   aws ssm start-session --profile terraform --region ap-south-1 --target i-0b2c0c0c89d40b0ee --document-name AWS-StartPortForwardingSession --parameters portNumber=8000,localPortNumber=18000
   ```
3. In another terminal, with a Coolify API token saved in `~/.coolify-token`:
   ```bash
   python3 infra/coolify/set-secrets.py
   ```
   It prints variable names, never values.
4. Redeploy the backend in Coolify.

## Rolling back

Two ways, for two situations:

- **Stop the bleeding:** in Coolify, open the app's deployments, pick the last
  good one, and redeploy it. No build, so it is the fastest way back to known
  working code.
- **Make it stick:** `git revert <commit>` and push. This deploys like any other
  change and leaves a record of what was undone and why. Do this after the quick
  rollback, or `main` still holds the broken change and the next push ships it
  again.

**The database schema does not roll back.** The backend runs
`drizzle-kit push` every time it starts, which moves the database to whatever
`schema.ts` says — and nothing ever moves it back. Rolling back code after a
schema change leaves old code running on the new schema. That is harmless for
an added nullable column and broken for a renamed or dropped one.

A schema change that would **lose data** makes `drizzle-kit push` stop and ask
for confirmation. A container cannot answer, so the push fails, the new
backend never starts, and Coolify keeps serving the previous container. That is
the safe failure, but it means a destructive schema change cannot ship by
pushing: plan it as its own step. Real, reversible migrations are an open item
(`docs/handoff.md`, "Later").

## Reading logs

Coolify → the app → **Logs**. Since T-047 the backend writes **one JSON object
per line**, so you can search for an event or a request id instead of reading
stack traces.

| event | what it means | useful fields |
| --- | --- | --- |
| `http_request` | a finished request (not `/health`, which is too frequent) | `requestId`, `method`, `path`, `status`, `ms` |
| `request_failed` | a 500 — something threw | `requestId`, `path`, `error` (with `cause`) |
| `job_failed` | a background job failed | `queue`, `jobId`, `data`, `error` |
| `generation_failed` | a topic could not be generated | `topicId`, `error`, `rawModelResponse` |
| `llm_call_failed` | a model call failed | `prompt`, `model`, `ms`, `error` |
| `readiness_check_failed` | `/health/ready` found a dependency down | `check`, `error` |
| `server_listening`, `shutting_down` | the process starting or stopping | `port`, `signal` |

Paths never include query strings, which carry sign-in tokens, and
credential-looking fields are replaced with `[redacted]`.

**Tracing a learner's error:** every API response carries an `X-Request-Id`
header, and a 500's body includes `requestId`. Search the backend logs for that
string to find every line about that request.

For a shell on the host itself, see `infra/README.md` ("Day to day").

## The Chrome extension

Coolify does not build or host it. A release is a zip, built locally:

```bash
WXT_API_URL=https://api.coldrecall.info pnpm --filter learner-os-extension zip
```

The zip lands in `extension/.output/`. `WXT_API_URL` is compiled into the
manifest's host permission, so a build made without it talks to
`localhost:3001` and nothing else.

**A production build cannot connect today, and here is why.** In production
the backend refuses any `chrome-extension://` origin that is not listed in
`EXTENSION_ORIGINS`, which is unset. It cannot be set yet, because the
extension has no fixed ID: the manifest carries no `key`, so every unpacked
install gets its own ID. A learner installing the zip sees "Could not reach
the backend" while the API is up.

**Releasing it:**

1. **Get a permanent extension ID** — one decision, the founder's:
   - publish to the Chrome Web Store (unlisted is enough for ten people); the ID
     is on the item's page and never changes, or
   - add a `key` to the manifest in `extension/wxt.config.ts`, which fixes the ID
     for unpacked installs too.
2. **Allow it:** set `EXTENSION_ORIGINS=chrome-extension://<that id>` on the
   backend in Coolify, then redeploy the backend.
3. **Check it:** install that build, connect it with a token from the web app's
   Connect extension screen, and answer a card. The answer should appear in
   `review_events` with `surface = extension`.
4. **For each later store upload,** raise `version` in `extension/package.json`
   first — the store rejects a repeated version.
