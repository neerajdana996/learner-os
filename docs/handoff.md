# Handoff — where things stand (2026-09-13)

> Read this first in a new session, then `grep -n -A1 '^### T-16' docs/tasks.md` for the task
> entries it cites. No secrets are recorded here, and none should ever be.

## Git

- Working branch: `task/T-168-coolify-single-host`. `origin/main` is at `4cf036f`.
- The five pending commits were pushed on 2026-09-13 (founder OK), together with `4cf036f`
  "Connect to Postgres over TLS only when the server offers it". The backend redeployed from
  `4cf036f` and is healthy; the frontend did not redeploy (no watch path matched) and is healthy.
- Local `main` is stale (18 behind); the branch is what gets pushed to `main`.

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
| `cutover` | **true** (applied 2026-09-13, plan was exactly 0 add / 3 change / 0 destroy). apex, `www`, `api` and `deploy` all → `13.204.7.173` |
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
- Schema: `drizzle-kit push` now runs at container start (`87cb1e6`); the `4cf036f` deploy logged
  "No changes detected" against the 14 tables, which is also the first proof the container itself
  can reach Postgres — the original push was run by hand from the founder's laptop over public 5432.
- Verified live on `http://l2am3wo5nncpsmnb4w1fwpdu.13.204.7.173.sslip.io` after the `4cf036f`
  deploy: `/health` 200; `/auth/verify?token=bogus` → 401 `invalid_token` (a real DB read, not a
  500); `/topics` → 401; `POST /auth/magic` → 200, which exercises user insert, token insert and
  the Mailgun send. Re-verified after cutover on the real domain: `https://api.coldrecall.info`
  serves a valid Let's Encrypt cert, `/health` → 200, `/auth/verify?token=bogus` → 401, and
  `POST /auth/magic` → 200, so the emailed sign-in link now resolves to the new host and works.
- Secrets were set by the founder running `python3 infra/coolify/set-secrets.py`.
- Scripts: `infra/coolify/bootstrap.py` (idempotent create), `infra/coolify/set-secrets.py`
  (founder runs it; prints names only).

## Email DNS (2026-09-13)

Mailgun's verification instructions were applied in `infra/prod/email_records.tf`, but **not
verbatim** — two of its records would have broken live mail:

- **SPF** is merged into the existing record (`v=spf1 include:_spf.google.com include:mailgun.org
  ~all`). Mailgun hands you a standalone `v=spf1 include:mailgun.org ~all`; publishing that as a
  second SPF record is a permerror that fails *both* senders.
- **Mailgun's MX records were deliberately not added.** They would take inbound mail away from
  Google Workspace and silence every `@coldrecall.info` address. Mailgun needs them only for
  inbound routes, and nothing here receives mail — learnos only sends.
- Added: the `email` tracking CNAME and a `_dmarc` policy at `p=none` (reporting only, cannot
  affect delivery). Tighten it once the aggregate reports show both senders aligning.
- `k1._domainkey` was already present and byte-identical to what Mailgun asked for — no change.

Applied plan was 2 add / 1 change / 0 destroy. Verified: MX still `1 smtp.google.com.`

## Open — in order

1. ~~Backend lifecycle job fails every minute~~ **Fixed in `4cf036f`.** The cause was never the
   query: `client.ts` set `ssl: 'require'` whenever `NODE_ENV === 'production'`, but the Coolify
   Postgres has `enable_ssl = false`, so *every* connection died during TLS negotiation
   (`ECONNRESET`). It looked like a query bug because drizzle wraps failures in
   `DrizzleQueryError`, whose `message` is only the SQL — the driver's error sits in `cause`, and
   the workers logged `.message`. It went unnoticed because `/health` touches no database.
   `sslmode` now comes from `DATABASE_URL` and defaults to `prefer`, which encrypts when the
   server offers TLS and falls back when it doesn't. Verified: no lifecycle failures since deploy.
2. ~~Verify the frontend~~ **Healthy.** `running:unhealthy` was a transient rolling-update reading.
3. ~~Push the local commits~~ **Pushed.** Still to do: clear the backend's `pre_deployment_command`
   in Coolify (still `pnpm drizzle-kit push`). `87cb1e6` is now live, so the container pushes the
   schema at start; the pre-deploy copy runs in the *old* container. It is currently a harmless
   no-op only because the schema hasn't changed — it will push a stale schema the first time it does.
3b. **Enable SSL on the Postgres** (`enable_ssl = false`, `ssl_mode = require`, `is_public = true`
   on 5432). Until then credentials cross the public port in cleartext. No code or connection-string
   change is needed — `prefer` picks TLS up automatically. Stronger still: close public 5432
   (`database_access_cidrs` is `0.0.0.0/0`) and use Coolify's internal network.
4. ~~DNS cutover~~ **Applied 2026-09-13**, plan exactly 0 add / 3 change / 0 destroy. apex and `www`
   moved off Vercel, `api` flipped CNAME→A off the legacy host. All four names resolve to
   `13.204.7.173` authoritatively and on public resolvers.
5. ~~Restart Coolify's proxy~~ **Not needed — Traefik issued every certificate on its own.**
   Forced at the host (`curl --resolve <name>:443:13.204.7.173`), apex, `www`, `api` and `deploy`
   all serve valid Let's Encrypt certs.

   **Measure through `--resolve`, not through your resolver.** Both wrong conclusions this session
   came from trusting a stale cache: apex looked self-signed and `api` looked like it was missing
   CORS, when in truth requests were still landing on the *legacy* host (`13.200.206.246`). The
   giveaway is `via: 1.1 Caddy` in a response header — the legacy host runs Caddy, the new one runs
   Traefik, so any Caddy header means you are talking to the old box. `dig` can disagree with
   `curl`: `dig` queries the nameserver directly while `curl` goes through the OS cache, and
   Google's anycast nodes expire independently. The old `api` CNAME was cached with a ~4 hour TTL
   from BigRock, well beyond the 300s Terraform sets, so expect stale clients for hours after a
   cutover even though the zone is correct.
6. **Rotate secrets exposed in chat:** OpenAI key, Mailgun SMTP password, GitHub and Google OAuth
   client secrets, and the Coolify `claude-setup` root token. Update `backend/.env`, re-run
   `set-secrets.py`, save the new token to `~/.coolify-token`.
7. After 48 quiet hours on the new host: `terraform destroy` the legacy stack (`infra/*.tf`, account
   `353400076760`), remove the Vercel project.
8. **Give the health check something that can fail.** `/health` returns a static `{ok:true}` and
   touches no database, so Coolify reported `running:healthy` through a total DB outage. A
   readiness endpoint that pings Postgres would have caught this in minutes. Keep it separate from
   the liveness path Coolify restarts on, so a DB blip can't cause a restart loop.
9. Later: T-166 live generation to observe item blocks; OAuth callback URLs for
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
