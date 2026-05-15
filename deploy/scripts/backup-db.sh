#!/usr/bin/env bash
# GetMCP Postgres backup. Pipes pg_dump (custom format, compressed) into a
# timestamped file. Designed to be cron-driven from the host:
#
#   0 */6 * * * /opt/getmcp/deploy/scripts/backup-db.sh >> /var/log/getmcp-backup.log 2>&1
#
# Restore: see deploy/scripts/restore-db.sh
#
# Honors $BACKUP_DIR (default /var/backups/getmcp) and $RETAIN_DAYS (default 14).
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/getmcp}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
DB_CONTAINER="${DB_CONTAINER:-getmcp_db}"
PG_USER="${POSTGRES_USER:-getmcp}"
PG_DB="${POSTGRES_DB:-getmcp_platform}"

mkdir -p "$BACKUP_DIR"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/getmcp-${ts}.dump"

echo "[$(date -u +%FT%TZ)] starting backup → $out"
docker exec -i "$DB_CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DB" -F c -Z 9 > "$out"

# Sanity: file is non-empty and Postgres custom-format header (PGDMP) is present.
if [ ! -s "$out" ] || ! head -c 5 "$out" | grep -q PGDMP; then
  echo "BACKUP FAILED — file empty or not a valid pg_dump archive" >&2
  rm -f "$out"
  exit 1
fi

bytes=$(stat -c%s "$out" 2>/dev/null || stat -f%z "$out")
echo "[$(date -u +%FT%TZ)] backup OK ($bytes bytes)"

# Prune older backups.
find "$BACKUP_DIR" -name 'getmcp-*.dump' -type f -mtime +"$RETAIN_DAYS" -print -delete
