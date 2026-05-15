#!/usr/bin/env bash
# First-time GetMCP self-host bootstrap.
#
# What it does:
#   1. Creates .env if missing, generating strong POSTGRES_PASSWORD and
#      KEY_ENCRYPTION_KEY via openssl rand.
#   2. Brings up postgres + waits for healthy.
#   3. Runs prisma migrate deploy.
#   4. Brings up the rest of the stack.
#   5. Runs the seed (one-time) so you have an org + API key + agents.
#
# Idempotent: re-running with .env present skips secret generation and just
# brings the stack up to current state.
set -euo pipefail

cd "$(dirname "$0")/../.."

COMPOSE="docker-compose -f docker-compose.prod.yml"

if [ ! -f .env ]; then
  echo "[bootstrap] generating .env with fresh secrets"
  cat > .env <<EOF
POSTGRES_USER=getmcp
POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '=+/' | head -c 32)
POSTGRES_DB=getmcp_platform
KEY_ENCRYPTION_KEY=$(openssl rand -hex 32)
CORS_ORIGINS=http://localhost,http://localhost:8080
VITE_API_URL=/api
LOG_LEVEL=info
# ANTHROPIC_API_KEY=  # uncomment + set to enable LLM endpoint classifier
EOF
  chmod 600 .env
  echo "[bootstrap] wrote .env (mode 600)"
else
  echo "[bootstrap] .env already present, skipping secret generation"
fi

echo "[bootstrap] starting postgres"
$COMPOSE up -d postgres

echo "[bootstrap] waiting for postgres healthy"
for i in $(seq 1 30); do
  status=$(docker inspect --format='{{.State.Health.Status}}' getmcp_db 2>/dev/null || echo "")
  if [ "$status" = "healthy" ]; then break; fi
  sleep 2
done
[ "$status" = "healthy" ] || { echo "postgres did not become healthy"; exit 1; }

echo "[bootstrap] running prisma migrate deploy"
$COMPOSE run --rm api-migrate

echo "[bootstrap] starting api + web"
$COMPOSE up -d api web

# Seed only if no organization exists yet.
existing=$(docker exec getmcp_db psql -U "${POSTGRES_USER:-getmcp}" -d "${POSTGRES_DB:-getmcp_platform}" -tAc 'SELECT COUNT(*) FROM "Organization";' 2>/dev/null || echo "0")
if [ "${existing// /}" = "0" ]; then
  echo "[bootstrap] seeding initial org + agents (one-time)"
  $COMPOSE exec -T api node prisma/seed.js
else
  echo "[bootstrap] $existing organization(s) already exist, skipping seed"
fi

echo ""
echo "GetMCP is up:"
echo "  Dashboard: http://localhost:8080"
echo "  API:       http://localhost:3000"
echo "  Health:    http://localhost:3000/health/ready"
echo "  Metrics:   http://localhost:3000/metrics"
