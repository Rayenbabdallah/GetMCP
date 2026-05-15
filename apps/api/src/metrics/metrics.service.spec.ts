import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let m: MetricsService;
  beforeEach(() => {
    m = new MetricsService();
  });

  it('renders Prometheus-format text and includes our custom metrics after first observation', async () => {
    m.recordProxy('EXECUTED', 'internal_mcp', 200, 12.3);
    m.recordPolicy('allow');
    m.recordAudit('ok');
    m.recordApproval('created');
    const { contentType, body } = await m.render();
    expect(contentType).toMatch(/text\/plain/);
    expect(body).toContain('getmcp_proxy_requests_total');
    expect(body).toContain('action="EXECUTED"');
    expect(body).toContain('upstream_status="200"');
    expect(body).toContain('getmcp_proxy_request_duration_ms_bucket');
    expect(body).toContain('getmcp_policy_decisions_total');
    expect(body).toContain('kind="allow"');
    expect(body).toContain('getmcp_audit_writes_total');
    expect(body).toContain('result="ok"');
    expect(body).toContain('getmcp_approval_events_total');
    expect(body).toContain('event="created"');
  });

  it('default Node metrics are exposed under getmcp_ prefix', async () => {
    const { body } = await m.render();
    expect(body).toContain('getmcp_process_cpu_user_seconds_total');
  });

  it('handles null upstream_status as "none" so the label cardinality stays bounded', async () => {
    m.recordProxy('BLOCKED', 'external_mcp', null, 1);
    const { body } = await m.render();
    expect(body).toContain('upstream_status="none"');
  });
});
