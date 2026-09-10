# `site/` — the public one-pager (coldrecall.info)

A static marketing site: `index.html`, `styles.css`, `404.html`, `favicon.svg`,
plus `CNAME`, `robots.txt` and `sitemap.xml`. No build step, no framework, no
runtime JavaScript. Open `index.html` in a browser and it is done.

It exists for two reasons: a live public URL for the **AWS Activate** credit
application, and somewhere to send a person who has heard the pitch and wants
to read it slowly.

**The site is branded Cold Recall; the product, the app and the extension are
learnos.** Deliberate, and not drift: the domain names the mechanism — a cold
test three weeks after the teaching stops — and that is a better thing to put
in front of a stranger than an internal name. Nothing in `frontend/`,
`extension/` or `packages/` is renamed, and this folder is the only place the
public name appears.

**The copy and the palette are the product's own**, transcribed from
`frontend/src/features/landing` (T-101) and `packages/ui/styles/`. Transcribed
rather than imported, because a static folder that needs `pnpm build` to render
is a folder that eventually ships stale. If a colour token changes in
`packages/ui`, change the block at the top of `styles.css` too — it is short
and it is all in one place.

## Before it goes live

1. **Replace the contact address.** Every `mailto:` points at
   `hello@example.com`. There are four (three in `index.html`, one in the
   footer nav):
   ```bash
   grep -rn "hello@example.com" site/
   ```
2. The domain is already set to `coldrecall.info` — in `CNAME`, the
   `<link rel="canonical">` and `og:url` in `index.html`, `robots.txt` and
   `sitemap.xml`. If it ever changes, those five are the whole list.
3. Nothing else. There is no analytics, no cookie banner, and no tracker — so
   there is also nothing to disclose, which is the shortest privacy policy
   available.

## Local preview

```bash
python3 -m http.server 8080 --directory site
```

Then `http://localhost:8080`. A plain `file://` open works too; the server only
matters for `404.html` and absolute `/` links.

## Hosting: GitHub Pages, with your domain and SSL

The repo (`neerajdana996/learner-os`) is public, so Pages is available on the
free plan. `.github/workflows/site.yml` publishes `site/` on every push to
`main` that touches it, and can be run by hand from the Actions tab.

### 1. Turn Pages on

GitHub → the repo → **Settings** → **Pages** → **Build and deployment** →
**Source: GitHub Actions**. Do this first: the workflow's deploy step fails
with a permissions error until Pages is enabled, which looks like a broken
workflow rather than an unticked box.

### 2. Deploy once

Push, or Actions → **Site** → **Run workflow**. Until the custom domain
resolves it lands at `https://neerajdana996.github.io/learner-os/`.

> ⚠ On that URL the relative paths work but a root-absolute link (`href="/"` in
> `404.html`) points at the wrong place, because the site is served from a
> sub-path. It is correct the moment a custom domain is attached, and a custom
> domain is the point — don't spend time on the sub-path case.

### 3. Point your domain at it

**`site/CNAME` already says `coldrecall.info`**, so Pages will serve the apex
domain as soon as DNS points at it. The records below are what makes that
resolve; add the `www` CNAME too, so a visitor who types `www.` still arrives.

At your DNS host, for an **apex** domain:

| Type | Name | Value |
| --- | --- | --- |
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| CNAME | `www` | `neerajdana996.github.io.` |

If your registrar refuses A records at the apex, use a `www`-only setup instead
— a `CNAME` for `www` → `neerajdana996.github.io.`, and change `site/CNAME` to
`www.coldrecall.info` to match. The two must agree; a `CNAME` file naming a
host that does not resolve is the one way to take the site offline from inside
the repo.

(The four A records are GitHub's published Pages addresses. If a deploy ever
starts 404ing months from now, re-check them against GitHub's docs before
anything else — they have changed once before.)

Then GitHub → **Settings** → **Pages** → **Custom domain**, enter
`coldrecall.info`, **Save**. The field and `site/CNAME` say the same thing on
purpose: the settings screen alone is lost if the repo is re-created, and the
file alone is enough for Pages to serve the domain.

Expect a few minutes of 404 between saving and DNS propagating. That is
normal — GitHub is already serving the custom domain by then, so the
`github.io` URL stops working at the same moment.

### 4. SSL

Once the DNS resolves, GitHub issues a Let's Encrypt certificate automatically
— no CSR, no upload, no cost. Tick **Enforce HTTPS** on the same Pages settings
screen as soon as it stops being greyed out (it is greyed out until the
certificate is issued, which is usually minutes and occasionally an hour). From
then on `http://` redirects to `https://` and renewal is automatic.

If **Enforce HTTPS** stays unavailable for more than a few hours, it is almost
always DNS: check with `dig +short coldrecall.info` that you see the four
GitHub addresses and nothing else — a leftover parking-page A record from the
registrar is the usual culprit, and `.info` registrars are fond of them.

### What this costs

Nothing. Pages is free for public repos, the certificate is free, and the only
bill is the domain registration. Worth knowing for the AWS Activate form: this
site is deliberately **not** on AWS, so the credits go to the thing that
actually burns money — Postgres, Redis, and the model calls behind topic
generation (~$0.46 and ~9 minutes per topic, measured in T-074).
