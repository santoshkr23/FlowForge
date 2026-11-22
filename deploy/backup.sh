#!/usr/bin/env bash
# Dump the FlowForge database (container Postgres) to deploy/backups, keeping 14 days.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p deploy/backups
DOCKER="docker"; docker info >/dev/null 2>&1 || DOCKER="sudo docker"
f="deploy/backups/flowforge-$(date +%F-%H%M).sql.gz"
$DOCKER compose -f docker-compose.prod.yml exec -T db pg_dump -U flowforge -d flowforge --no-owner | gzip > "$f"
find deploy/backups -name 'flowforge-*.sql.gz' -mtime +14 -delete
echo "$(date -Is) saved $f"
