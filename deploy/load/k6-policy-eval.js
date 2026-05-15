// Policy engine micro-benchmark.
//
// Hits /policies/simulate at increasing load to find the per-instance ceiling
// of the pure-CPU path (auth → cache hit on rules → engine evaluate → audit
// write fire-and-forget). No upstream involved.
//
// Use this to:
//   - Establish a baseline p50/p95/p99 for policy eval on a given pod size
//   - Find the RPS at which p95 starts climbing (the saturation point)
//   - Compare two builds (run before + after a change with the same VUs)

import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_KEY = __ENV.API_KEY || '';

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-arrival-rate',
      startRate: 100,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 500,
      stages: [
        { target: 100,  duration: '30s' },
        { target: 500,  duration: '60s' },
        { target: 1000, duration: '60s' },
        { target: 1500, duration: '60s' },
        { target: 0,    duration: '15s' },
      ],
    },
  },
  thresholds: {
    'http_req_failed': ['rate<0.01'],
    'http_req_duration': ['p(95)<25', 'p(99)<80'],
  },
};

const headers = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
};
const body = JSON.stringify({
  method: 'GET',
  path: '/v1/charges',
  source: 'external_mcp',
  tenantId: 'tenant-loadtest',
  reasoning: 'k6 policy eval microbench — read tenant charges',
});

export default function () {
  const r = http.post(`${BASE_URL}/policies/simulate`, body, { headers });
  check(r, { 'ok': (res) => res.status === 200 });
}
