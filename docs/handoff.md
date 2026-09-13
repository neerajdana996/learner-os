# Handoff — where things stand (2026-09-13)

> Read this first in a new session, then `grep -n -A1 '^### T-16' docs/tasks.md` for the task
> entries it cites. No secrets are recorded here, and none should ever be.

## Git

- Working branch: `task/T-168-coolify-single-host`. `origin/main` is at `d61e9bb`.
- **Five local commits are not on GitHub** — pushing to `main` triggers Coolify auto-deploy, so
  ask the founder before pushing:
  - `9fecaa4` Coolify bootstrap script
  - `1a7b990` optional public DB access (Terraform)
  - `7889d2e` T-168 notes
  - `56500bd` `set-secrets.py` + `.env` quote fix
  - `87cb1e6` **backend Dockerfile runs `drizzle-kit push` at container start** (see open item 3)

## Done this session

- **Generation pipeline:** T-164 (rule severities + repair retry), T-165 (held-out concepts can't
  be prerequisites of taught ones), T-167 (teach blocks only where a domain fragment allows) —
  all done and verified live. T-166 stays `in_progress`: the domain classifier is fixed (1 → 8
  `code` concepts on a Python topic) but rich-format item blocks have not been observed in a full
  generation yet. A malformed `teachBlock` is now dropped, not fatal.
- **Docs:** 122 finished tasks moved to `docs/tasks-done.md`; `CLAUDE.md` and `loop.md` read
  tasks by grep.
- **Local dev:** `backend/.env` points at the docker Postgres/Redis; hosted URLs kept commented.
  `pnpm db:reset` (dry run; `--yes`; `--allow-remote` for hosted).

## AWS (T-168) — live

| | |
| --- | --- |
| Account | `719312763365` (holds the credit, ~$120). Legacy api + t3.micro live in `353400076760` |
| CLI profile | `terraform` (AdministratorAccess), region `ap-south-1` |
| Instance | `i-0b2c0c0c89d40b0ee`, t4g.large arm64, Elastic IP `13.204.7.173`, ~$41/month |
| State | S3 `learnos-tfstate-719312763365`; bootstrap state only in `infra/bootstrap/terraform.tfstate` (gitignored — keep a copy) |
| DNS | Route 53 zone `Z03726822IYSE191YYZ40`; BigRock nameservers already switched to it |
| `cutover` | **false** — `coldrecall.info`/`www` → Vercel `76.76.21.21`, `api` → legacy EC2. `deploy` → new host |
| DB access | `database_access_cidrs = ["0.0.0.0/0"]` in gitignored `infra/prod/terraform.tfvars` (founder decision) |

Stacks are pinned with `allowed_account_ids`. Every apply so far ran from a saved plan gated on
the reviewed resource counts — keep doing that.

## Coolify — live

- Version 4.3.19. Dashboard: `https://deploy.coldrecall.info` (Let's Encrypt cert still pending —
  see open item 5). Private access through the tunnel:
  `aws ssm start-session --profile terraform --region ap-south-1 --target i-0b2c0c0c89d40b0ee --document-name AWS-StartPortForwardingSession --parameters portNumber=8000,localPortNumber=18000`
  then `http://localhost:18000`. API calls go through this tunnel.
- Admin account exists. API token `claude-setup` (**root**) saved in `~/.coolify-token`.
- GitHub App `coldrecall-git` (uuid `xa9nzxtqsfydbsxhfzgkcuah`) installed on `neerajdana996/learner-os`.
- Project `coldrecall` (`g2y43rguuj4km1vsn2quwgue`), environment `production` (`m0uxklcslkvmro6tu7x8l7mf`):

| resource | uuid | state |
| --- | --- | --- |
| Postgres 16 | `qqxf9wijvbdolcisry9orj5j` | healthy, public 5432, SCRAM password verified |
| Redis 7 | `gqdbqpw0gche1bbvxfefbdoq` | healthy, public 6379, NOAUTH verified |
| backend | `l2am3wo5nncpsmnb4w1fwpdu` | deployed from `d61e9bb`, `/health` → `{"ok":true}` inside the container |
| frontend | `od9tnhrewhudjbj48dcdzfak` | deployed from `d61e9bb`; rolling update healthy but app status then read `running:unhealthy` |

- Both apps auto-deploy on push to `main`, with watch paths (`backend/**`, `packages/shared/**`,
  lockfile / `frontend/**`, `packages/**`, lockfile).
- Schema: `drizzle-kit push` was run **by hand** on the empty database → 14 tables.
- Secrets were set by the founder running `python3 infra/coolify/set-secrets.py`.
- Scripts: `infra/coolify/bootstrap.py` (idempotent create), `infra/coolify/set-secrets.py`
  (founder runs it; prints names only).

## Open — in order

1. **Backend lifecycle job fails every minute, even after the schema exists.** Its query (topics
   join users, status in active/holdout/testing/done) failed at 07:55:39Z, after the push. The same
   query run in `psql` as `learnos` returns 0 rows without error, and `users.timezone` exists.
   Drizzle logs only the query, not the cause. Leading guess: the worker's connection or prepared
   state predates the tables — **restart the backend container and see whether failures stop**; if
   not, capture the real Postgres error (e.g. run the query from inside the backend container with
   its own `DATABASE_URL`).
2. **Verify the frontend** — `running:unhealthy` contradicts the healthy rolling update.
3. **Push the five local commits** (founder OK). Once `87cb1e6` is live, clear the backend's
   `pre_deployment_command` in Coolify (still `pnpm drizzle-kit push`): Coolify runs it in the
   *old* container, so it would push the previous version's schema.
4. **DNS cutover** — founder approved "after backend and frontend are healthy". Set `cutover = true`
   in `infra/prod/terraform.tfvars`; the plan must be exactly **0 add, 3 change, 0 destroy**
   (`apex`, `www`, `api`); apply that saved plan.
5. **Restart Coolify's proxy** once DNS resolves everywhere, so Let's Encrypt issues certificates
   for `deploy`, `api`, apex and `www` (its only attempts were at 07:11Z, before DNS moved).
6. **Rotate secrets exposed in chat:** OpenAI key, Mailgun SMTP password, GitHub and Google OAuth
   client secrets, and the Coolify `claude-setup` root token. Update `backend/.env`, re-run
   `set-secrets.py`, save the new token to `~/.coolify-token`.
7. After 48 quiet hours on the new host: `terraform destroy` the legacy stack (`infra/*.tf`, account
   `353400076760`), remove the Vercel project.
8. Later: T-166 live generation to observe item blocks; OAuth callback URLs for
   `https://api.coldrecall.info`; `EXTENSION_ORIGINS` once the extension has a fixed ID; the
   `@xyflow/react` vs `loop.md` §2 decision; delete `.pnpm-store/` (gitignored) if unwanted;
   migrate from `drizzle-kit push` to real migrations.

## Rules settled with the founder

- Never enter or set secrets (API keys, passwords, tokens) — the founder pastes them or runs
  `set-secrets.py`. Never print secret values; redact DB URLs and keys in any log output.
- Ask before pushing to `main` (it deploys), before any `terraform apply`, and before changing
  live DNS. Gate applies on exact plan counts.
- Save Claude credits: one task per session, grep instead of reading big files, cheap two-call
  checks before full 26-call generations.
