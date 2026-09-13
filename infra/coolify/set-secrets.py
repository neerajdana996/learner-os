#!/usr/bin/env python3
"""
Put the backend's secrets into Coolify in one step (T-168). Run it yourself:

    python3 infra/coolify/set-secrets.py

Sets six variables on the `backend` app:
  - DATABASE_URL, REDIS_URL          internal URLs, read from the Coolify databases
  - OPENAI_API_KEY, SMTP_PASS,
    GITHUB_CLIENT_SECRET,
    GOOGLE_CLIENT_SECRET             read from backend/.env

Prints variable NAMES only, never values. Needs ~/.coolify-token and the SSM
tunnel on localhost:18000 (see infra/README.md).
"""
import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("COOLIFY_URL", "http://localhost:18000")
TOKEN_FILE = os.path.expanduser("~/.coolify-token")
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

BACKEND_UUID = "l2am3wo5nncpsmnb4w1fwpdu"
POSTGRES_UUID = "qqxf9wijvbdolcisry9orj5j"
REDIS_UUID = "gqdbqpw0gche1bbvxfefbdoq"
FROM_DOTENV = ["OPENAI_API_KEY", "SMTP_PASS", "GITHUB_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"]


def unquote(v):
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    return v


def api(method, path, token, body=None):
    req = urllib.request.Request(BASE + "/api/v1" + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {path} -> HTTP {e.code}")  # body omitted: it may echo values


def main():
    if not os.path.isfile(TOKEN_FILE):
        sys.exit(f"no Coolify token at {TOKEN_FILE}")
    token = open(TOKEN_FILE).read().strip()

    try:
        urllib.request.urlopen(BASE + "/api/health", timeout=10).read()
    except Exception:
        sys.exit("Coolify is not reachable on localhost:18000 — open the SSM tunnel first (see infra/README.md)")

    values = {}
    for key, uuid in (("DATABASE_URL", POSTGRES_UUID), ("REDIS_URL", REDIS_UUID)):
        url = api("GET", f"/databases/{uuid}", token).get("internal_db_url")
        if not url:
            sys.exit(f"could not read the internal URL for {key} — the token may lack read access to secrets")
        values[key] = url

    dotenv = {}
    path = os.path.join(REPO_ROOT, "backend", ".env")
    for line in open(path):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            dotenv[k.strip()] = unquote(v)
    missing = [k for k in FROM_DOTENV if not dotenv.get(k)]
    if missing:
        sys.exit(f"missing or empty in backend/.env: {', '.join(missing)}")
    values.update({k: dotenv[k] for k in FROM_DOTENV})

    data = [{"key": k, "value": v, "is_preview": False, "is_literal": True} for k, v in values.items()]
    api("PATCH", f"/applications/{BACKEND_UUID}/envs/bulk", token, {"data": data})
    print("set on backend: " + ", ".join(values))
    print("Done. Tell Claude: secrets in")


if __name__ == "__main__":
    main()
