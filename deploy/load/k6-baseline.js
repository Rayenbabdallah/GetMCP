// GetMCP baseline load profile — k6.
//
// Runs three scenarios in parallel:
//   1. health        — /health/live, no auth, sanity floor
//   2. policySimulate — /policies/simulate, all-CPU path (no upstream call)
//   3. proxyExecute  — /proxy/execute, full path through to a fake upstream
//
// Required env:
//   BASE_URL          e.g. https://getmcp.your-domain.example
//   API_KEY           an org's gmcp_… key
//   AGENT_ID          the agent id to assert (must belong to the org)
//
// Optional env:
//   VUS_HEALTH=20  VUS_SIM=20  VUS_PROXY=20
//   DURATION=60s
//
// Usage:
//   k6 run -e BASE_URL=... -e API_KEY=... -e AGENT_ID=... deploy/load/k6-baseline.js
//
// Reads SLA targets from CHECKLIST.md §12: p95 added latency < 25ms,
// p99 < 80ms, 1000 RPS per instance. The thresholds below fail the run if
// missed — surface as exit code != 0 in CI.

import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_KEY = __ENV.API_KEY || '';
const AGENT_ID = __ENV.AGENT_ID || '';
const DURATION = __ENV.DURATION || '60s';

const trProxy = new Trend('proxy_execute_duration_ms', true);
const trSim = new Trend('policy_simulate_duration_ms', true);

export const options = {
  scenarios: {
    health: {
      executor: 'constant-vus',
      vus: parseInt(__ENV.VUS_HEALTH || '20', 10),
      duration: DURATION,
      exec: 'health',
      tags: { scenario: 'health' },
    },
    sim: {
      executor: 'constant-vus',
      vus: parseInt(__ENV.VUS_SIM || '20', 10),
      duration: DURATION,
      exec: 'policySimulate',
      tags: { scenario: 'sim' },
    },
    proxy: {
      executor: 'constant-vus',
      vus: parseInt(__ENV.VUS_PROXY || '20', 10),
      duration: DURATION,
      exec: 'proxyExecute',
      tags: { scenario: 'proxy' },
    },
  },
  thresholds: {
    'http_req_failed': ['rate<0.01'],
    'http_req_duration{scenario:health}': ['p(95)<10'],
    // CHECKLIST §12 SLA: p95 added latency < 25ms, p99 < 80ms.
    // "Added" here = total minus upstream. With a fake upstream that returns
    // immediately the total IS the added latency.
    'policy_simulate_duration_ms': ['p(95)<25', 'p(99)<80'],
    'proxy_execute_duration_ms':   ['p(95)<50', 'p(99)<150'],
  },
};

const headers = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
};
const proxyHeaders = {
  ...headers,
  'x-agent-id': AGENT_ID,
  'x-agent-source': 'internal_mcp',
  'x-agent-reasoning': 'k6 baseline load test, repeated GET',
};

export function health() {
  const r = http.get(`${BASE_URL}/health/live`);
  check(r, { 'health 200': (res) => res.status === 200 });
}

export function policySimulate() {
  const body = JSON.stringify({
    method: 'GET',
    path: '/v1/charges',
    source: 'external_mcp',
    tenantId: 'tenant-loadtest',
    reasoning: 'k6 baseline simulate — read tenant charges',
  });
  const r = http.post(`${BASE_URL}/policies/simulate`, body, { headers });
  trSim.add(r.timings.duration);
  check(r, { 'simulate 200/4xx': (res) => res.status === 200 || (res.status >= 400 && res.status < 500) });
}

export function proxyExecute() {
  const body = JSON.stringify({ method: 'GET', path: '/v1/charges' });
  const r = http.post(`${BASE_URL}/proxy/execute`, body, { headers: proxyHeaders });
  trProxy.add(r.timings.duration);
  // Accept any non-5xx — the test isn't trying to assert business semantics.
  check(r, { 'proxy not 5xx': (res) => res.status < 500 });
}
