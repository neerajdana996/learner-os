# infra — one Coolify host on AWS

Everything runs on **one EC2 machine managed by Coolify** — web app, API, worker,
Postgres and Redis — until there is a reason to split it (T-168). Terraform owns
the machine; Coolify owns what runs on it.

```
infra/
  bootstrap/            one-time: the S3 bucket Terraform state lives in
  modules/coolify-host/ the machine, its firewall, backups and snapshots
  modules/dns/          the coldrecall.info zone in Route 53
  prod/                 wires those together, plus spend alerts
  *.tf (this folder)    LEGACY — the old t3.micro stack; destroy after cutover
```

## What it costs

ap-south-1 on-demand, roughly per month:

| item | cost |
| --- | --- |
| t4g.large (2 vCPU, 8 GiB) | ~$33 |
| public IPv4 address | ~$3.65 |
| 40 GB gp3 disk | ~$3–4 |
| S3 backups + daily snapshots | ~$1–2 |
| Route 53 hosted zone | $0.50 |
| **total** | **~$42** |

The first 100 GB of data out each month is free. The budget alert is set to
$45 and measures **gross** spend — AWS Budgets subtracts credits by default,
which would make it read $0 until the credit ran out.

## Before anything

1. **Terraform ≥ 1.10**, the **AWS CLI**, and the **Session Manager plugin**
   for the CLI (for shell access; there is no SSH).
2. **An IAM user or role for Terraform**, created in the AWS console. The
   `js-ai-lab-cli` user can read EC2 but cannot manage IAM, Route 53, Budgets
   or DLM, all of which this stack creates.
   `export AWS_PROFILE=<that profile>` in every shell below.

## Bring it up

**1. State bucket (once per account).**

```bash
cd infra/bootstrap && terraform init && terraform apply
```

**2. The host and the zone.** Nothing is created until you approve the plan.

```bash
cd infra/prod
cp terraform.tfvars.example terraform.tfvars   # set alert_email
terraform init -backend-config="bucket=$(cd ../bootstrap && terraform output -raw state_bucket)"
terraform plan -out=tfplan                     # review this
terraform apply tfplan
```

Confirm the budget alert subscription email AWS sends to `alert_email`.

**3. Move the nameservers — early, and safely.** In BigRock, replace the four
`dns*.bigrock.in` nameservers with the four from `terraform output name_servers`.
With `cutover = false` the new zone serves exactly what BigRock serves today
(site on Vercel, `api` on the legacy box, email unchanged), so nothing a
visitor sees changes. Do this days before cutover: BigRock's records carry a
4-hour TTL, so the move takes a while to reach everyone.

Check it: `dig NS coldrecall.info +short` shows the `awsdns` servers, and mail
still arrives.

**4. Set up Coolify.**

```bash
$(terraform output -raw coolify_dashboard_tunnel)   # then open http://localhost:8000
```

- Create the admin account **immediately** — until then, anyone who can reach
  the dashboard can claim it. (It is only reachable through the tunnel.)
- Settings → set the instance domain to `https://deploy.coldrecall.info`. After
  that the dashboard is served over HTTPS and the tunnel is no longer needed.
- Add an S3 destination using `terraform output backup_bucket`, and schedule
  Postgres backups (every 4 hours, keep 7 days is a sensible start).
  **Open question:** if Coolify's S3 form requires an access key rather than
  using the instance role, create an IAM user whose only permission is that
  bucket.

**5. Deploy the stack in Coolify** — Postgres, Redis, the backend (API and
worker) and the frontend — each on its final domain. Test end to end.
**Restore a backup into a scratch database before real users arrive**: a backup
that has never been restored is not yet a backup.

**6. Cut over.** Set `cutover = true` in `terraform.tfvars`, then
`terraform plan` (expect `apex`, `www` and `api` to change and nothing else) and
`terraform apply`. Coolify issues HTTPS certificates as the names start
resolving to the host.

**7. Retire the old setup** after 48 quiet hours: `terraform destroy` in this
folder (the legacy t3.micro stack, with its local state), then remove the
Vercel project.

## Day to day

- **Shell:** `$(terraform output -raw shell)`
- **Bigger machine:** change `instance_type`, `plan`, `apply` — a stop and
  start, a few minutes of downtime. Stay on a `g` (Graviton) type; the image is
  arm64.
- **Deploys** happen in Coolify, not here. Nothing in this folder changes when
  the app does.
