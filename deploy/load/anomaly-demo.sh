#!/usr/bin/env bash
# BEHAVIORAL_ANOMALY demo. Shows the detector going from "within baseline"
# to "anomaly" in real time.
#
# Sequence:
#   1. Create a BEHAVIORAL_ANOMALY rule (audit_only mode — we want to observe,
#      not block, so the demo doesn't 403 mid-loop)
#   2. Build a baseline: 60 GETs to /v1/charges (enough to clear the default
#      minBaselineSamples=50 threshold)
#   3. Score a familiar call (GET /v1/charges) → expect anomaly score ~0
#   4. Score an unfamiliar call (DELETE /admin/users) → expect score ~1
#   5. Show the persisted scores in the audit log
#
# Required env:
#   BASE_URL=http://localhost:3000          (default)
#   API_KEY=gmcp_…                          (REQUIRED)
#   AGENT_ID=<external_mcp agent id>        (REQUIRED — must be source=external_mcp)
#
# Required upstream:
#   The org's upstreamBaseUrl must be set (e.g. https://httpbin.org) so the
#   proxy can actually forward calls and build the audit chain.

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
[ -n "${API_KEY:-}" ] || { echo "API_KEY required" >&2; exit 2; }
[ -n "${AGENT_ID:-}" ] || { echo "AGENT_ID required (must be source=external_mcp)" >&2; exit 2; }

AUTH=(-H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json")
JQ=$(command -v jq || true)

say() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()  { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
hi()  { printf '  \033[1;33m%s\033[0m\n' "$*"; }

say "1. Create BEHAVIORAL_ANOMALY rule (audit_only mode)"
RULE_ID=$(curl -s -X POST "$BASE_URL/policies" "${AUTH[@]}" -d '{
  "name": "demo: behavioural anomaly",
  "description": "audit_only demo rule — fires when a request diverges from this agent baseline",
  "ruleType": "BEHAVIORAL_ANOMALY",
  "targetMethod": "*",
  "targetPath": "*",
  "actionConfig": {
    "sensitivity": 0.9,
    "minBaselineSamples": 50,
    "baselineWindowDays": 7,
    "onAnomaly": "audit_only"
  },
  "priority": 40
}' | { if [ -n "$JQ" ]; then jq -r .id; else grep -oE '"id":"[^"]+"' | head -1 | cut -d'"' -f4; fi; })
ok "rule_id=$RULE_ID"

say "2. Build baseline — 60 GET /v1/charges as agent $AGENT_ID"
for i in $(seq 1 60); do
  curl -s -X POST "$BASE_URL/proxy/execute" "${AUTH[@]}" \
    -H "x-agent-id: $AGENT_ID" \
    -H "x-agent-source: external_mcp" \
    -H "x-tenant-id: demo-tenant" \
    -H "x-agent-reasoning: baseline traffic, run #$i" \
    -d '{"method":"GET","path":"/get?session=baseline"}' > /dev/null
  printf '.'
done
printf '\n'
ok "60 audited calls written"

say "3. Score a familiar call via /policies/simulate"
SIM_FAMILIAR=$(curl -s -X POST "$BASE_URL/policies/simulate" "${AUTH[@]}" -d "{
  \"method\": \"GET\",
  \"path\": \"/get?session=baseline\",
  \"source\": \"external_mcp\",
  \"agentId\": \"$AGENT_ID\",
  \"tenantId\": \"demo-tenant\",
  \"reasoning\": \"familiar call — should be within baseline\"
}")
if [ -n "$JQ" ]; then
  echo "$SIM_FAMILIAR" | jq '.trace[] | select(.ruleType == "BEHAVIORAL_ANOMALY")'
else
  echo "$SIM_FAMILIAR"
fi
hi "Expect: score ≈ 0, 'within baseline'"

say "4. Score an unfamiliar call (DELETE /admin/users)"
SIM_ANOMALY=$(curl -s -X POST "$BASE_URL/policies/simulate" "${AUTH[@]}" -d "{
  \"method\": \"DELETE\",
  \"path\": \"/admin/users\",
  \"source\": \"external_mcp\",
  \"agentId\": \"$AGENT_ID\",
  \"tenantId\": \"demo-tenant\",
  \"reasoning\": \"unfamiliar path the agent has never touched\"
}")
if [ -n "$JQ" ]; then
  echo "$SIM_ANOMALY" | jq '.trace[] | select(.ruleType == "BEHAVIORAL_ANOMALY")'
else
  echo "$SIM_ANOMALY"
fi
hi "Expect: score ≈ 1, 'never seen', anomaly flagged"

say "5. Audit log — most recent rows with their persisted anomaly scores"
if [ -n "$JQ" ]; then
  curl -s "$BASE_URL/audit?limit=3" "${AUTH[@]}" | jq '.data[] | {seq, method, path, actionTaken, anomalyScore}'
else
  curl -s "$BASE_URL/audit?limit=3" "${AUTH[@]}"
fi

say "Cleanup — delete the demo rule"
curl -s -X DELETE "$BASE_URL/policies/$RULE_ID" "${AUTH[@]}" > /dev/null
ok "rule deleted"

printf '\n\033[1;32mDemo complete.\033[0m The familiar call scored near 0, the unfamiliar call near 1.\n'
printf 'In production, change "onAnomaly":"audit_only" to "block" once you trust the baseline.\n\n'
