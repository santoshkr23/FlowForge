#!/usr/bin/env bash
# Copy your existing data (users, workflows, connections, posts) from Neon into the VPS Postgres.
#   bash deploy/move-from-neon.sh "postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require"
# Use the SAME ENCRYPTION_KEY in .env as on Render, or saved connections can't be decrypted.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${1:?pass the Neon connection string in quotes}"
SRC="${SRC//&channel_binding=require/}"; SRC="${SRC//channel_binding=require&/}"; SRC="${SRC//\?channel_binding=require/}"
DOCKER="docker"; docker info >/dev/null 2>&1 || DOCKER="sudo docker"
C="$DOCKER compose -f docker-compose.prod.yml"
echo "Stopping the app while copying…"
$C stop app
$C up -d db
sleep 3
echo "Copying data from Neon…"
$C exec -T db sh -c "pg_dump --no-owner --no-acl --clean --if-exists \"$SRC\" | psql -q -v ON_ERROR_STOP=0 -U flowforge -d flowforge" 
$C up -d app
echo "Done. Sign in with your existing account."
