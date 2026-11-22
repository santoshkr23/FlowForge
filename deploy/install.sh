#!/usr/bin/env bash
# One-time FlowForge setup on an Ubuntu/Debian VPS.
#   cd ~/FlowForge && bash deploy/install.sh
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1;34m▸ %s\033[0m\n' "$*"; }

if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker"
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER" || true
fi
DOCKER="docker"; docker info >/dev/null 2>&1 || DOCKER="sudo docker"

if [ ! -f .env ]; then
  say "Creating .env"
  cp deploy/.env.production.example .env
  read -rp "Domain for FlowForge (e.g. flowforge.yourdomain.com): " DOMAIN
  read -rp "Your login email (admin): " ADMIN
  read -rp "ENCRYPTION_KEY from Render (press Enter to generate a new one): " ENC
  [ -z "$ENC" ] && ENC=$(openssl rand -hex 32)
  sed -i "s|^APP_URL=.*|APP_URL=https://${DOMAIN}|; s|^FLOWFORGE_DOMAIN=.*|FLOWFORGE_DOMAIN=${DOMAIN}|; s|^ADMIN_EMAILS=.*|ADMIN_EMAILS=${ADMIN}|" .env
  sed -i "s|^AUTH_SECRET=.*|AUTH_SECRET=$(openssl rand -hex 32)|; s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=${ENC}|; s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 16)|" .env
  chmod 600 .env
  echo "Saved .env (keep a private copy of ENCRYPTION_KEY)."
fi

say "Building and starting FlowForge (first build takes a few minutes)"
$DOCKER compose -f docker-compose.prod.yml up -d --build

PORT=$(grep -E '^FLOWFORGE_PORT=' .env | cut -d= -f2); PORT=${PORT:-3100}
say "Waiting for the app on 127.0.0.1:${PORT}"
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then echo "FlowForge is up."; break; fi
  sleep 3
done

if ! (ss -ltn 2>/dev/null | grep -qE ':(80|443)\s'); then
  echo
  echo "Nothing is using ports 80/443. To get HTTPS automatically, run:"
  echo "  $DOCKER compose -f docker-compose.prod.yml --profile caddy up -d"
else
  echo
  echo "Ports 80/443 are already used (your other sites). Add the block in deploy/Caddyfile"
  echo "or deploy/nginx-flowforge.conf to that proxy, pointing at 127.0.0.1:${PORT}."
fi

say "Daily database backup at 03:15 (keeps 14 days in deploy/backups)"
( crontab -l 2>/dev/null | grep -v 'flowforge-backup' ; echo "15 3 * * * cd $(pwd) && bash deploy/backup.sh >> deploy/backups/backup.log 2>&1 # flowforge-backup" ) | crontab -
mkdir -p deploy/backups
echo "Done."
