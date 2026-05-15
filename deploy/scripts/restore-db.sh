#!/usr/bin/env bash
# Restore a GetMCP Postgres backup.
#
# Usage: ./restore-db.sh <path-to-dump>
#
# DESTRUCTIVE — overwrites the current database. The script asks for explicit
# confirmation; pass FORCE=1 to skip the prompt (e.g. from a runbook script).
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: $0 <backup.dump>" >&2
  exit 2
fi

dump="$1"
[ -f "$dump" ] || { echo "no such file: $dump" >&2; exit 1; }

DB_CONTAINER="${DB_CONTAINER:-getmcp_db}"
PG_USER="${POSTGRES_USER:-getmcp}"
PG_DB="${POSTGRES_DB:-getmcp_platform}"

if [ "${FORCE:-0}" != "1" ]; then
  echo "About to RESTORE $dump into $DB_CONTAINER:$PG_DB"
  echo "This DROPS the existing schema. Type 'restore' to confirm:"
  read -r ans
  [ "$ans" = "restore" ] || { echo "aborted"; exit 1; }
fi

# pg_restore with --clean drops existing objects first; --if-exists prevents
# errors when objects don't exist on a fresh DB.
docker exec -i "$DB_CONTAINER" pg_restore -U "$PG_USER" -d "$PG_DB" --clean --if-exists < "$dump"

echo "restore complete"
