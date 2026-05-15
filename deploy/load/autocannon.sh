#!/usr/bin/env bash
# Quick local smoke benchmark via autocannon (no install — npx).
# 30s, 50 concurrent connections, hits /policies/simulate.
#
# Use this for "did my change make things faster or slower" — full SLA
# verification belongs in k6.
#
# Required env:
#   BASE_URL  default http://localhost:3000
#   API_KEY   required
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
[ -n "${API_KEY:-}" ] || { echo "API_KEY required" >&2; exit 2; }

body='{"method":"GET","path":"/v1/charges","source":"external_mcp","tenantId":"tenant-bench","reasoning":"autocannon smoke benchmark, repeated GET"}'

npx --yes autocannon \
  -d 30 \
  -c 50 \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -m POST \
  -b "$body" \
  "$BASE_URL/policies/simulate"
