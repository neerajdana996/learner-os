# Handoff — where things stand (2026-09-14)

> Read this first in a new session, then `grep -n -A1 '^### T-16' docs/tasks.md` for the task
> entries it cites. No secrets are recorded here, and none should ever be.

## Start here

Nothing is mid-flight. The last session closed T-166 and T-169 and left the tree clean.

**T-166 is done and the number is in:** a live generation (topic `4964b32e`, *Sliding window and
prefix sums*, Python) produced **5 items carrying a `clozeCode` block out of 94**, against **0 in
every previous run**. The generator writes blocks now.

**The half that is not solved, and is deliberately left open:** all five are `clozeCode`. No
`hotspotLine`, `orderLines` or `codeEditor`. The decision list is *stop at the first yes* and its
first entry is "a rule with a boundary", which nearly every code concept has — so entry 1 answers
first almost every time. **Do not fix this with a quota or by reordering the list:** that produces
a format chosen for its own sake, which is what the earn-it sentences exist to prevent. Whether a
course of five cloze items is actually worse for a learner than a mixed one is a pilot measurement
(T-045), not a prompt tweak. Full detail in `tasks-done.md` under T-166.

**Decided and shipped (2026-09-14):** the extension opens as a **side panel**, not a popup
(`e1dca53`), and the panel asks **every** answer format — `orderLines` (`e4c38b5`) and
`codeEditor` (T-171). `codeEditor` is also a review in the web session now. Only the Day-30 test
still refuses both. See T-171 in `tasks-done.md`.

## Git

- Working branch: `task/T-168-coolify-single-host`. `origin/main` is at `a030034`.
- **Commits are local and unpushed.** Pushing deploys — the frontend on any `frontend/**` or
  `packages/**` change, the backend on `backend/**`. The backend ones carry the enrichment pass,
  which is now proven live, so pushing is no longer shipping something unverified.
- Local `main` is stale; the branch is what gets pushed to `main`.
- The last deploy was the brand rename + legal pages; the live site is unaffected by anything above.

## Done 2026-09-14

- **T-166 closed** (moved to `tasks-done.md`): the two-phase enrichment pass, proven by a live
  generation — 5 `clozeCode` items where every previous run produced none. Cost ~$0.02 and ~8
  extra calls on a ~21-call topic.
- **T-169 fixed** (moved to `tasks-done.md`): `/due` spent its LIMIT on due *cards* and filtered
  *items* afterwards, so one ineligible card consumed the popup's `limit=1` and the learner was
  told "nothing due" while their queue was full. Both regression tests were confirmed to fail
  against the old code before being kept.
- **Cloze grading fixed**: the grader indexed answers by `holes` order, the renderer by `{{n}}`
  marker order, and nothing made them agree — a correct answer could be marked wrong, silently.
  One shared `clozeHoleOrder()` now serves both.
- **Three card-rendering bugs fixed**, all found by screenshotting every format for the first
  time: ClozeCode rendered overlapping lines, `orderLines` text was invisible, and a five-node
  `diagram` was clipped.
- **Four e2e failures fixed**, none of them regressions: a duplicate `<h1>` on the landing page
  (a real accessibility bug), and session specs that never handled an `example_first` opening.
- **E2E-008 both halves landed**: `e2e/web/formats.spec.ts` and `e2e/extension/formats.spec.ts`.
  `pnpm e2e:report` is now a contact sheet of every question surface the product can show.
- **Privacy, terms and contact pages**, plus a real footer — the site had none, while asking for
  an email address. Live.
- **The product is called Cold Recall everywhere a person can see it** — site, emails, extension.

## Known flake

The backend suite fails intermittently on a *different* DB-touching test each run (seen on
`diagnostic` and `topics`, ~1 in 3 runs, 667/668 passing). It passes clean on a re-run. Not
investigated; suspect shared-database state between files rather than anything in the code under
test. Worth a task if it gets worse.

## Done 2026-09-13

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

- Version 4.3.19. Dashboard: `https://deploy.coldrecall.info` — valid Let's Encrypt cert, as have
  apex, `www` and `api`; Traefik issued them all without the proxy restart that was expected.
  Private access through the tunnel (**it expires — reopen it in a new session**):
  `aws ssm start-session --profile terraform --region ap-south-1 --target i-0b2c0c0c89d40b0ee --document-name AWS-StartPortForwardingSession --parameters portNumber=8000,localPortNumber=18000`
  then `http://localhost:18000`. API calls go through this tunnel.
- Admin account exists. API token `claude-setup` (**root**) saved in `~/.coolify-token`.
- GitHub App `coldrecall-git` (uuid `xa9nzxtqsfydbsxhfzgkcuah`) installed on `neerajdana996/learner-os`.
- Project `coldrecall` (`g2y43rguuj4km1vsn2quwgue`), environment `production` (`m0uxklcslkvmro6tu7x8l7mf`):

| resource | uuid | state |
| --- | --- | --- |
| Postgres 16 | `qqxf9wijvbdolcisry9orj5j` | healthy, public 5432, SCRAM password verified |
| Redis 7 | `gqdbqpw0gche1bbvxfefbdoq` | healthy, public 6379, NOAUTH verified |
| backend | `l2am3wo5nncpsmnb4w1fwpdu` | healthy; TLS to Postgres enforced (`sslmode=require`), `pre_deployment_command` cleared |
| frontend | `od9tnhrewhudjbj48dcdzfak` | healthy; serving Cold Recall branding and the legal pages |

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
3. ~~Push the local commits~~ **Pushed**, and the backend's `pre_deployment_command` is now cleared
   (it was `pnpm drizzle-kit push`, which Coolify ran in the *old* container). The container-start
   push from `87cb1e6` is the only schema push now.
3b. ~~Enable SSL on the Postgres~~ **Done 2026-09-13.** `enable_ssl = true`. Coolify rewrote
   `internal_db_url` to carry `?sslmode=require`, and the backend's `DATABASE_URL` was re-synced
   from it, so TLS is now *enforced*, not merely preferred. Verified after a restart: healthy,
   a live DB read returns 401, zero connection errors. `set-secrets.py` reads `internal_db_url`
   directly, so re-running it keeps `sslmode=require` rather than regressing it.
   Still open: public 5432 is open to `0.0.0.0/0`, and `require` encrypts without verifying the
   certificate. Closing the public port and using only Coolify's internal network is the real fix.
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
7. ~~`terraform destroy` the legacy stack~~ **Destroyed 2026-09-15 ~00:25 IST**, at the founder's
   request ~14h before the 48-hour window closed. Saved plan, exactly 0/0/6: instance
   `i-09317eaacfb23fa32` (its root volume went with it), EIP `13.200.206.246`, `learnos-sg`,
   `learnos-key` and the local `.pem`. `infra/versions.tf` now pins `allowed_account_ids` to
   `353400076760`. Verified after: nothing left in that account but the undeletable default SG;
   the current host in `719312763365` untouched and healthy. **Still open: remove the Vercel
   project.** `infra/deploy-backend.sh`, which targeted the destroyed host, was deleted.
8. **Audit findings not yet acted on** (2026-09-14, from reading the code — none confirmed by
   running it, and each says so):
   - **Fixed in T-171** — confirmed, and TypeScript was broken too (the browser ran it as
     JavaScript). Only JavaScript runs client-side now; everything else is judged by the
     `gradeCode` prompt on the server. **Proven live 2026-09-15:** 46/46 labelled answers across
     five languages, $0.00024 each, p90 2.7s — re-run `pnpm eval:grade-code` before changing the
     prompt or its model. The original finding, for the record:
     ~~`codeEditor` is graded wrong for 8 of 10 languages.~~ Only JS/TS run client-side; the rest
     post `{"__source": "<code>"}` claiming the server judges it, and no server path reads
     `__source` — so `grade.ts` substitutes `' '` and every case fails, every time. The same
     shape as T-118. Not in the enrichment pass's path (its decision list offers only `clozeCode`
     and `hotspotLine`), so it did not block that work.
   - **`reveal`-slot blocks are shown on no surface at all** — stripped server-side
     (`blocks.ts`'s public projection) and filtered client-side (`BlockList` renders only
     `context`). They would be generated, stored and billed for nothing. The enrichment prompt
     forbids them for this reason.
   - **`short` is validated and never rendered**, and the popup is **300px**, not the 380px every
     comment about it assumes. `hotspotLine` is the most exposed: 12 lines at a 44px tap target is
     ~528px in a 300px popup, and its schema has no `short` variant.
9. **Give the health check something that can fail.** `/health` returns a static `{ok:true}` and
   touches no database, so Coolify reported `running:healthy` through a total DB outage. A
   readiness endpoint that pings Postgres would have caught this in minutes. Keep it separate from
   the liveness path Coolify restarts on, so a DB blip can't cause a restart loop.
10. Later: OAuth callback URLs for
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
