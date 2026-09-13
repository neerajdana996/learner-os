#!/usr/bin/env python3
"""
Create the coldrecall stack in Coolify through its API (T-168).

    python3 infra/coolify/bootstrap.py --dry-run     # print every payload, call nothing
    python3 infra/coolify/bootstrap.py               # create what does not exist yet

Creates, reusing anything that already exists by name:
  - project `coldrecall` (production environment)
  - Postgres 16 and Redis 7 — Coolify generates both passwords
  - `backend`  — builds backend/Dockerfile, serves api.coldrecall.info
  - `frontend` — builds frontend/Dockerfile, serves coldrecall.info (+ www)

Both apps are wired to the `coldrecall-git` GitHub App with auto-deploy on push
to `main`, and created WITHOUT deploying: the backend would crash-loop without
its database URL and secrets, which are never set here.

What this script deliberately does not touch
  Secrets. DATABASE_URL, REDIS_URL, OPENAI_API_KEY, SMTP_PASS and the two OAuth
  client secrets are pasted into Coolify by a person. The token comes from
  ~/.coolify-token and is never printed. Only non-secret settings are copied
  from backend/.env, and their values are not printed either.

Talks to Coolify through the SSM tunnel on localhost:18000 (see infra/README.md),
so the token never crosses an unverified certificate.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("COOLIFY_URL", "http://localhost:18000") + "/api/v1"
TOKEN_FILE = os.path.expanduser("~/.coolify-token")
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

# Read from the live instance on 2026-09-13 (read-only SSM queries).
SERVER_UUID = "eberpyiykonvshvxs3jivvgw"        # localhost
DESTINATION_UUID = "lgjblrovsr2v441vuyw554dg"   # docker network `coolify`
GITHUB_APP_UUID = "xa9nzxtqsfydbsxhfzgkcuah"    # coldrecall-git (installed)

# Descriptions sent to Coolify may only use letters, numbers, spaces and - _ . , ! ? ( ) ' " + = * / @ &
# Anything else (an em dash, a colon) fails with HTTP 422.
PROJECT = "coldrecall"
ENVIRONMENT = "production"
REPO = "neerajdana996/learner-os"
BRANCH = "main"

API_DOMAIN = "https://api.coldrecall.info"
WEB_DOMAINS = "https://coldrecall.info,https://www.coldrecall.info"

POSTGRES = {"name": "postgres", "image": "postgres:16-alpine", "postgres_user": "learnos", "postgres_db": "learnos"}
REDIS = {"name": "redis", "image": "redis:7-alpine"}

# Non-secret settings copied from backend/.env when present there.
COPY_FROM_DOTENV = ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "MAIL_FROM", "GITHUB_CLIENT_ID", "GOOGLE_CLIENT_ID"]

# Production values. NODE_ENV=production is the load-bearing one: in
# development the dev sign-in route is live with a default password.
BACKEND_ENV = {
    "NODE_ENV": "production",
    "PORT": "3001",
    "APP_URL": "https://coldrecall.info",
    "API_URL": API_DOMAIN,
    "CORS_ORIGINS": WEB_DOMAINS,
    "LLM_PROVIDER": "openai",
    "ADMIN_EMAILS": "neeraj.dana@coldrecall.info",
    # EXTENSION_ORIGINS stays unset (valid: defaults to empty). In production the
    # API then refuses the Chrome extension until its chrome-extension://<id> is added.
}
FRONTEND_ENV = {"VITE_API_URL": API_DOMAIN}

SECRETS_FOR_A_PERSON = ["DATABASE_URL", "REDIS_URL", "OPENAI_API_KEY", "SMTP_PASS", "GITHUB_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"]


def backend_app(project_uuid, env_uuid):
    return {
        **_app_common(project_uuid, env_uuid),
        "name": "backend",
        "description": "API + generation, test and lifecycle workers (one process)",
        "dockerfile_location": "/backend/Dockerfile",
        "ports_exposes": "3001",
        "domains": API_DOMAIN,
        "health_check_enabled": True,
        "health_check_path": "/health",
        "health_check_port": "3001",
        # Push, not migrate: there is no migrations folder yet. Without --force a
        # change that would drop data fails the deploy instead of dropping it.
        "pre_deployment_command": "pnpm drizzle-kit push",
        "watch_paths": "backend/**\npackages/shared/**\npnpm-lock.yaml",
    }


def frontend_app(project_uuid, env_uuid):
    return {
        **_app_common(project_uuid, env_uuid),
        "name": "frontend",
        "description": "Web app, static build served by nginx",
        "dockerfile_location": "/frontend/Dockerfile",
        "ports_exposes": "80",
        "domains": WEB_DOMAINS,
        "redirect": "non-www",
        "health_check_enabled": True,
        "health_check_path": "/",
        "health_check_port": "80",
        "watch_paths": "frontend/**\npackages/**\npnpm-lock.yaml",
    }


def _app_common(project_uuid, env_uuid):
    return {
        "project_uuid": project_uuid,
        "server_uuid": SERVER_UUID,
        "destination_uuid": DESTINATION_UUID,
        "environment_name": ENVIRONMENT,
        "environment_uuid": env_uuid,
        "github_app_uuid": GITHUB_APP_UUID,
        "git_repository": REPO,
        "git_branch": BRANCH,
        "build_pack": "dockerfile",
        "base_directory": "/",
        "is_auto_deploy_enabled": True,
        "is_force_https_enabled": True,
        "instant_deploy": False,
    }


class Api:
    def __init__(self, dry_run):
        self.dry_run = dry_run
        self.token = None
        if not dry_run:
            if not os.path.isfile(TOKEN_FILE) or os.path.getsize(TOKEN_FILE) == 0:
                sys.exit(f"no token at {TOKEN_FILE} — create one in Coolify (write + deploy) and save it there")
            with open(TOKEN_FILE) as f:
                self.token = f.read().strip()

    def call(self, method, path, body=None):
        if self.dry_run:
            print(f"\n{method} {path}")
            if body is not None:
                print(json.dumps(body, indent=2))
            return {}
        req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None)
        req.add_header("Authorization", f"Bearer {self.token}")
        req.add_header("Content-Type", "application/json")
        req.add_header("Accept", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read().decode()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            # The error body names the rule; it never contains the token.
            sys.exit(f"{method} {path} -> HTTP {e.code}: {e.read().decode()[:400]}")


def read_dotenv_values(keys):
    path = os.path.join(REPO_ROOT, "backend", ".env")
    found = {}
    if os.path.isfile(path):
        for line in open(path):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if k in keys and v.strip():
                found[k] = v.strip()
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="print payloads; call nothing; read no token")
    args = ap.parse_args()
    api = Api(args.dry_run)

    if not args.dry_run:
        health = urllib.request.urlopen(BASE.replace("/api/v1", "/api/health"), timeout=10).read().decode()
        print(f"coolify health: {health.strip()}")

    # --- project and its production environment ---
    projects = [] if args.dry_run else api.call("GET", "/projects")
    project = next((p for p in projects if p.get("name") == PROJECT), None)
    if project:
        project_uuid = project["uuid"]
        print(f"project {PROJECT}: exists ({project_uuid})")
    else:
        created = api.call("POST", "/projects", {"name": PROJECT, "description": "Cold Recall - web app, API, Postgres, Redis"})
        project_uuid = created.get("uuid", "<project-uuid>")
        print(f"project {PROJECT}: created ({project_uuid})")

    envs = [] if args.dry_run else api.call("GET", f"/projects/{project_uuid}/environments")
    env = next((e for e in envs if e.get("name") == ENVIRONMENT), None)
    env_uuid = env["uuid"] if env else "<environment-uuid>"
    if not args.dry_run and not env:
        sys.exit(f"project {PROJECT} has no `{ENVIRONMENT}` environment — create it in Coolify, then re-run")
    print(f"environment {ENVIRONMENT}: {env_uuid}")

    base = {"server_uuid": SERVER_UUID, "destination_uuid": DESTINATION_UUID, "project_uuid": project_uuid,
            "environment_name": ENVIRONMENT, "environment_uuid": env_uuid, "is_public": False, "instant_deploy": True}

    # --- databases (names checked within this project) ---
    existing_dbs = [] if args.dry_run else api.call("GET", "/databases")
    def db_exists(name):
        return next((d for d in existing_dbs if d.get("name") == name and d.get("environment_id") is not None and project_uuid in json.dumps(d)), None) \
            or next((d for d in existing_dbs if d.get("name") == name), None)

    for kind, spec in (("postgresql", POSTGRES), ("redis", REDIS)):
        found = db_exists(spec["name"])
        if found:
            print(f"database {spec['name']}: exists ({found.get('uuid')})")
            continue
        created = api.call("POST", f"/databases/{kind}", {**base, **spec})
        print(f"database {spec['name']}: created ({created.get('uuid', '<uuid>')}) — deploying")

    # --- applications ---
    existing_apps = [] if args.dry_run else api.call("GET", "/applications")
    app_uuids = {}
    for build in (backend_app, frontend_app):
        payload = build(project_uuid, env_uuid)
        found = next((a for a in existing_apps if a.get("name") == payload["name"]), None)
        if found:
            app_uuids[payload["name"]] = found["uuid"]
            print(f"app {payload['name']}: exists ({found['uuid']})")
            continue
        created = api.call("POST", "/applications/private-github-app", payload)
        app_uuids[payload["name"]] = created.get("uuid", f"<{payload['name']}-uuid>")
        print(f"app {payload['name']}: created ({app_uuids[payload['name']]}) — not deployed")

    # --- non-secret environment variables ---
    copied = read_dotenv_values(COPY_FROM_DOTENV)
    backend_env = {**BACKEND_ENV, **copied}
    for name, env_vars in (("backend", backend_env), ("frontend", FRONTEND_ENV)):
        data = [{"key": k, "value": v, "is_preview": False, "is_literal": True} for k, v in env_vars.items()]
        if args.dry_run:
            # Show keys only for anything copied from .env; the defaults above are public.
            shown = [{**d, "value": d["value"] if d["key"] in BACKEND_ENV or d["key"] in FRONTEND_ENV else "<from backend/.env>"} for d in data]
            api.call("PATCH", f"/applications/<{name}-uuid>/envs/bulk", {"data": shown})
        else:
            api.call("PATCH", f"/applications/{app_uuids[name]}/envs/bulk", {"data": data})
        print(f"env {name}: {len(data)} non-secret variable(s) set — {', '.join(sorted(env_vars))}")

    print("\nStill to paste into the backend in Coolify (secrets, by a person):")
    for key in SECRETS_FOR_A_PERSON:
        print(f"  - {key}")
    print("DATABASE_URL and REDIS_URL: use each database's *internal* URL from its Coolify page.")
    print("\nNothing has been deployed. After the secrets are in, deploy the backend, then the frontend.")


if __name__ == "__main__":
    main()
