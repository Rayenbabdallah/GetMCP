import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  // Proxy hot path
  readonly proxyRequests: Counter<string>;
  readonly proxyDuration: Histogram<string>;

  // Policy engine
  readonly policyDecisions: Counter<string>;

  // Audit ledger
  readonly auditWrites: Counter<string>;

  // Approvals
  readonly approvalEvents: Counter<string>;

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: 'getmcp_' });

    this.proxyRequests = new Counter({
      name: 'getmcp_proxy_requests_total',
      help: 'Number of /proxy/execute requests, labeled by outcome.',
      labelNames: ['action', 'source', 'upstream_status'],
      registers: [this.registry],
    });

    this.proxyDuration = new Histogram({
      name: 'getmcp_proxy_request_duration_ms',
      help: 'Latency from controller entry to response finish.',
      labelNames: ['action', 'source'],
      buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000],
      registers: [this.registry],
    });

    this.policyDecisions = new Counter({
      name: 'getmcp_policy_decisions_total',
      help: 'Policy engine decisions, labeled by kind.',
      labelNames: ['kind'],
      registers: [this.registry],
    });

    this.auditWrites = new Counter({
      name: 'getmcp_audit_writes_total',
      help: 'Audit ledger insert outcomes.',
      labelNames: ['result'],
      registers: [this.registry],
    });

    this.approvalEvents = new Counter({
      name: 'getmcp_approval_events_total',
      help: 'Approval lifecycle events: created, approved, denied, expired.',
      labelNames: ['event'],
      registers: [this.registry],
    });
  }

  recordProxy(action: string, source: string, upstreamStatus: number | null, durationMs: number) {
    this.proxyRequests.inc({ action, source, upstream_status: upstreamStatus !== null ? String(upstreamStatus) : 'none' });
    this.proxyDuration.observe({ action, source }, durationMs);
  }
  recordPolicy(kind: string) { this.policyDecisions.inc({ kind }); }
  recordAudit(result: 'ok' | 'failed') { this.auditWrites.inc({ result }); }
  recordApproval(event: 'created' | 'approved' | 'denied' | 'expired') {
    this.approvalEvents.inc({ event });
  }

  async render(): Promise<{ contentType: string; body: string }> {
    return {
      contentType: this.registry.contentType,
      body: await this.registry.metrics(),
    };
  }
}
