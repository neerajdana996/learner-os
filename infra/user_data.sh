#!/bin/bash
# Runs once, on the instance's first boot (cloud-init). Installs everything
# needed to run the backend the same way it runs locally — Node, pnpm, pm2 as
# the process manager, and Caddy for automatic HTTPS + reverse proxy — but
# does NOT deploy the app itself. That's a separate step once this box is up,
# so a bad app deploy never means re-provisioning infrastructure.
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y curl git ca-certificates gnupg

# --- Node.js 20 LTS (NodeSource's official Ubuntu repo) ---
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# --- pnpm + pm2 ---
npm install -g pnpm@9 pm2

# --- Caddy (official apt repo — automatic HTTPS via Let's Encrypt) ---
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy

# --- App directory, owned by the login user (not root) ---
mkdir -p /opt/learnos
chown ubuntu:ubuntu /opt/learnos

touch /opt/learnos/.bootstrap-complete
