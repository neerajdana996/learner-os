#!/bin/bash
# Builds the backend (and its workspace deps) and ships a self-contained copy
# to the EC2 instance's /opt/learnos/current, then (re)starts it under pm2.
#
# Deliberately does NOT touch /opt/learnos/.env — that file holds real
# production secrets, is created once by hand, and every deploy just execs
# against whatever is already there via start.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="ubuntu@13.200.206.246"
KEY="$ROOT/infra/learnos-key.pem"
REMOTE_DIR="/opt/learnos/current"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "==> Building (packages/shared, packages/ui, backend)..."
cd "$ROOT"
pnpm --filter @learnos/shared... --filter learner-os-backend build

echo "==> Packaging a self-contained deploy (pnpm deploy)..."
pnpm --filter learner-os-backend deploy --prod "$STAGE"

echo "==> Adding dist/ (pnpm deploy excludes it as gitignored)..."
cp -r "$ROOT/backend/dist" "$STAGE/dist"

echo "==> Restoring \"type\": \"module\" (pnpm deploy drops it — cosmetic, but avoids a startup warning)..."
node -e "
const fs = require('fs');
const path = '$STAGE/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.type = 'module';
fs.writeFileSync(path, JSON.stringify(pkg, null, 2));
"

echo "==> Shipping to $HOST:$REMOTE_DIR..."
ssh -i "$KEY" "$HOST" "mkdir -p $REMOTE_DIR.new"
rsync -az --delete -e "ssh -i $KEY" "$STAGE/" "$HOST:$REMOTE_DIR.new/"
ssh -i "$KEY" "$HOST" "rm -rf $REMOTE_DIR.old; [ -d $REMOTE_DIR ] && mv $REMOTE_DIR $REMOTE_DIR.old; mv $REMOTE_DIR.new $REMOTE_DIR"

echo "==> Restarting the service..."
ssh -i "$KEY" "$HOST" "pm2 describe learnos-api > /dev/null 2>&1 && pm2 restart learnos-api || pm2 start /opt/learnos/start.sh --name learnos-api"
ssh -i "$KEY" "$HOST" "pm2 save"

echo "==> Done. Tailing the last 20 log lines:"
ssh -i "$KEY" "$HOST" "pm2 logs learnos-api --lines 20 --nostream"
