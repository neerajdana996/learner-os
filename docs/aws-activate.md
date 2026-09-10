# AWS Activate application — answers

> Kept here because the form has several fields and they should tell one
> consistent story. Public URL: `http://www.coldrecall.info/`
> (HTTPS pending certificate issuance; repo `neerajdana996/learner-os`).
>
> **Framing note.** This is a business disclosure, not marketing copy, so the
> closed beta is a strength here — evidence of a real launch plan — where on a
> public page it would be internal noise (see `docs/copy.md`). It is described
> as a closed beta cohort rather than as an experiment run on participants.
> Nothing here overstates traction: there are no users yet and the answer says
> so.

---

## "What are you building?"

**Cold Recall is a retention tool for technical learning — the part that runs
after the tutorial.**

The problem it addresses is that completion is measured and retention is not.
People finish a course, understand it while they read it, and cannot use the
material three weeks later. Every incumbent measures progress by what you
clicked through.

**The product.** You give it a technical topic. It generates a concept map —
twenty to forty concepts with real prerequisite edges — then runs a
fifteen-question adaptive diagnostic to establish what you already know, and
teaches only the gaps in short daily sessions, each new concept opening with an
attempt *before* any explanation. Between sessions a Chrome extension asks one
twenty-second retrieval question, inside hours you choose and under a cap you
set, scheduled by a model that predicts when you are about to forget. Weeks
after the teaching stops it asks again cold — no revision, no cue — and reports
what actually stuck, concept by concept. That last number is the reason the
product exists, and what it is named after.

**Stage.** Built and running end to end: generation, diagnostic, teaching
sessions, the scheduler, the extension, and the cold test. Opening to a closed
beta cohort now, ahead of public launch. Not yet monetised; the intended model
is a per-learner subscription with a team tier for engineering onboarding.

**Technology.** TypeScript throughout, in a single pnpm/Turborepo monorepo.
Node with Express and WebSockets for the API; PostgreSQL via Drizzle as the
system of record; Redis with BullMQ for the content-generation workers; React,
Vite and Redux Toolkit for the web client; and a Manifest V3 Chrome extension.
Content generation is LLM-based — currently OpenAI behind a provider interface,
with per-task model tiering — and every generated artifact is schema-validated
before it is stored, so malformed model output fails loudly instead of reaching
a learner. Scheduling uses FSRS.

**On AWS** we would run the API and the worker fleet on **ECS Fargate**,
**RDS** for PostgreSQL, **ElastiCache** for Redis, **S3 + CloudFront** for the
web client and marketing site, **Secrets Manager** for credentials,
**CloudWatch** for logs and metrics, and **SES** for transactional email.
**Bedrock** is the natural place to evaluate alternative models against our
current provider without changing application code.

**Where credits would go.** Content generation is the cost driver, and we have
measured it: one topic is roughly seventy-three model calls, ~91k input and
~48k output tokens, and about nine minutes of worker time. Credits let us
pre-generate and hand-review a library of topics — and run the worker fleet and
database that serve them — rather than rationing topics while we prove
retention.

---

## Short version (if the field is capped near 1,000 characters)

Cold Recall is a retention tool for technical learning — the part that runs
after the tutorial. Give it a technical topic and it generates a concept map,
runs an adaptive diagnostic to find what you already know, teaches only the
gaps, then a Chrome extension asks one twenty-second retrieval question a day
inside hours you choose, timed by a model that predicts when you are about to
forget. Weeks later it tests you cold and reports what actually stuck.

It is built and running end to end, opening to a closed beta ahead of public
launch. TypeScript throughout: Node/Express and WebSockets, PostgreSQL
(Drizzle), Redis and BullMQ workers, React/Vite, and a Manifest V3 Chrome
extension. Content is LLM-generated and schema-validated before storage.

On AWS: ECS Fargate for the API and workers, RDS, ElastiCache, S3 + CloudFront,
Secrets Manager, CloudWatch, SES, and Bedrock to evaluate models. Generation is
our cost driver — about seventy-three model calls per topic — so credits go
directly into building a reviewed topic library.
