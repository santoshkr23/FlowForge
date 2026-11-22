#!/usr/bin/env bash
# Pull the latest code and restart with zero config changes.  bash deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DOCKER="docker"; docker info >/dev/null 2>&1 || DOCKER="sudo docker"
git pull --ff-only
$DOCKER compose -f docker-compose.prod.yml up -d --build app
$DOCKER image prune -f >/dev/null
echo "Updated."
