import { BehavioralBaselineService } from './baseline.service';

// Synthetic audit data: configurable per-test, drives the fake Prisma's
// findMany + count responses.
function fakePrisma(audit: Array<{ method: string; path: string; timestamp: Date; agentId: string; organizationId: string }>) {
  return {
    auditLog: {
      findMany: jest.fn().mockImplementation(async ({ where, select }: any) => {
        return audit
          .filter((r) =>
            r.organizationId === where.organizationId &&
            r.agentId === where.agentId &&
            (!where.timestamp?.gte || r.timestamp >= where.timestamp.gte),
          )
          .map((r) => ({ method: r.method, path: r.path }));
      }),
      count: jest.fn().mockImplementation(async ({ where }: any) => {
        return audit.filter((r) =>
          r.organizationId === where.organizationId &&
          r.agentId === where.agentId &&
          (!where.timestamp?.gte || r.timestamp >= where.timestamp.gte),
        ).length;
      }),
    },
  } as any;
}

function row(method: string, path: string, msAgo: number, agentId = 'agent-1', organizationId = 'org-A') {
  return { method, path, timestamp: new Date(Date.now() - msAgo), agentId, organizationId };
}

describe('BehavioralBaselineService.getBaseline', () => {
  it('builds a path-probability map weighted by frequency', async () => {
    const audit = [
      ...Array.from({ length: 80 }, () => row('GET', '/v1/charges', 60_000)),
      ...Array.from({ length: 18 }, () => row('GET', '/v1/customers', 60_000)),
      ...Array.from({ length: 2 }, () => row('POST', '/v1/refunds', 60_000)),
    ];
    const svc = new BehavioralBaselineService(fakePrisma(audit));
    const b = await svc.getBaseline('org-A', 'agent-1', 7);
    expect(b.sampleCount).toBe(100);
    expect(b.pathProbability.get('GET /v1/charges')).toBeCloseTo(0.8, 2);
    expect(b.pathProbability.get('GET /v1/customers')).toBeCloseTo(0.18, 2);
    expect(b.pathProbability.get('POST /v1/refunds')).toBeCloseTo(0.02, 2);
  });

  it('caches per (org, agent, window) — second call skips Prisma', async () => {
    const audit = [row('GET', '/x', 60_000)];
    const prisma = fakePrisma(audit);
    const svc = new BehavioralBaselineService(prisma);
    await svc.getBaseline('org-A', 'agent-1', 7);
    await svc.getBaseline('org-A', 'agent-1', 7);
    expect(prisma.auditLog.findMany).toHaveBeenCalledTimes(1);
  });

  it('different agents do not share cache entries', async () => {
    const audit = [row('GET', '/x', 60_000, 'agent-1'), row('GET', '/y', 60_000, 'agent-2')];
    const prisma = fakePrisma(audit);
    const svc = new BehavioralBaselineService(prisma);
    const a = await svc.getBaseline('org-A', 'agent-1', 7);
    const b = await svc.getBaseline('org-A', 'agent-2', 7);
    expect(a.pathProbability.has('GET /x')).toBe(true);
    expect(b.pathProbability.has('GET /y')).toBe(true);
    expect(prisma.auditLog.findMany).toHaveBeenCalledTimes(2);
  });

  it('invalidate() drops the cache for one agent', async () => {
    const audit = [row('GET', '/x', 60_000)];
    const prisma = fakePrisma(audit);
    const svc = new BehavioralBaselineService(prisma);
    await svc.getBaseline('org-A', 'agent-1', 7);
    svc.invalidate('org-A', 'agent-1');
    await svc.getBaseline('org-A', 'agent-1', 7);
    expect(prisma.auditLog.findMany).toHaveBeenCalledTimes(2);
  });
});

describe('BehavioralBaselineService.scoreRequest', () => {
  it('common path + normal rate → low composite score', async () => {
    const audit = Array.from({ length: 100 }, () => row('GET', '/v1/charges', 24 * 60 * 60 * 1000));
    const svc = new BehavioralBaselineService(fakePrisma(audit));
    const s = await svc.scoreRequest('org-A', 'agent-1', 'GET', '/v1/charges', 7);
    expect(s.pathScore).toBe(0);
    // 100 rows over 1 day = ~0.07 calls/min baseline; recent count of 0 → 0 score
    expect(s.volumeScore).toBe(0);
    expect(s.composite).toBe(0);
  });

  it('never-seen path → path score 1.0', async () => {
    const audit = Array.from({ length: 100 }, () => row('GET', '/v1/charges', 24 * 60 * 60 * 1000));
    const svc = new BehavioralBaselineService(fakePrisma(audit));
    const s = await svc.scoreRequest('org-A', 'agent-1', 'DELETE', '/admin/users', 7);
    expect(s.pathScore).toBe(1);
    expect(s.composite).toBe(1);
    expect(s.reason).toMatch(/never seen/);
  });

  it('rare path (< 10% historical) → graded path score', async () => {
    const audit = [
      ...Array.from({ length: 95 }, () => row('GET', '/v1/charges', 24 * 60 * 60 * 1000)),
      ...Array.from({ length: 5 }, () => row('POST', '/v1/refunds', 24 * 60 * 60 * 1000)),
    ];
    const svc = new BehavioralBaselineService(fakePrisma(audit));
    const s = await svc.scoreRequest('org-A', 'agent-1', 'POST', '/v1/refunds', 7);
    // 5% historical → 1 - 0.05/0.1 = 0.5
    expect(s.pathScore).toBeCloseTo(0.5, 1);
  });

  it('volume spike (10× baseline rate) → volume score 1.0', async () => {
    // Build a baseline of 100 calls over 7 days (~0.01/min) PLUS 200 recent calls in the last 60s
    const audit = [
      ...Array.from({ length: 100 }, () => row('GET', '/v1/charges', 5 * 24 * 60 * 60 * 1000)),
      ...Array.from({ length: 200 }, () => row('GET', '/v1/charges', 30_000)),
    ];
    const svc = new BehavioralBaselineService(fakePrisma(audit));
    const s = await svc.scoreRequest('org-A', 'agent-1', 'GET', '/v1/charges', 7);
    expect(s.volumeScore).toBeCloseTo(1, 1); // way above 10× baseline
  });

  it('reports baselineSampleCount so callers can enforce min-baseline policies', async () => {
    const audit = Array.from({ length: 12 }, () => row('GET', '/v1/charges', 60_000));
    const svc = new BehavioralBaselineService(fakePrisma(audit));
    const s = await svc.scoreRequest('org-A', 'agent-1', 'GET', '/v1/charges', 7);
    expect(s.baselineSampleCount).toBe(12);
  });
});
