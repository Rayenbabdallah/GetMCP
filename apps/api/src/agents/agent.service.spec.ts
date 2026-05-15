import { AgentService } from './agent.service';

function fakePrisma(rows: any[]) {
  const findFirst = jest.fn().mockImplementation(async ({ where }: any) => {
    return rows.find((r) => r.id === where.id && r.organizationId === where.organizationId) ?? null;
  });
  const update = jest.fn().mockResolvedValue(undefined);
  return {
    prisma: {
      agentIdentity: { findFirst, update },
    } as any,
    findFirst,
    update,
  };
}

describe('AgentService.resolve', () => {
  it('returns null for an unknown agentId and caches the negative result', async () => {
    const { prisma, findFirst } = fakePrisma([]);
    const svc = new AgentService(prisma);

    expect(await svc.resolve('org-A', 'missing')).toBeNull();
    expect(await svc.resolve('org-A', 'missing')).toBeNull();
    expect(findFirst).toHaveBeenCalledTimes(1); // second call hit cache
  });

  it('refuses to resolve an agent of org-B when called with org-A scope', async () => {
    const { prisma } = fakePrisma([
      { id: 'agent-1', organizationId: 'org-B', source: 'internal_mcp', tenantScope: null, enabled: true, revokedAt: null },
    ]);
    const svc = new AgentService(prisma);
    expect(await svc.resolve('org-A', 'agent-1')).toBeNull();
  });

  it('caches a positive resolve and skips the second DB call', async () => {
    const { prisma, findFirst } = fakePrisma([
      { id: 'agent-1', organizationId: 'org-A', source: 'internal_mcp', tenantScope: null, enabled: true, revokedAt: null },
    ]);
    const svc = new AgentService(prisma);

    const a = await svc.resolve('org-A', 'agent-1');
    const b = await svc.resolve('org-A', 'agent-1');
    expect(a?.id).toBe('agent-1');
    expect(b?.id).toBe('agent-1');
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('invalidate() forces a fresh DB lookup on the next resolve', async () => {
    const rows: any[] = [
      { id: 'agent-1', organizationId: 'org-A', source: 'internal_mcp', tenantScope: null, enabled: true, revokedAt: null },
    ];
    const { prisma, findFirst } = fakePrisma(rows);
    const svc = new AgentService(prisma);

    await svc.resolve('org-A', 'agent-1');
    expect(findFirst).toHaveBeenCalledTimes(1);

    // Simulate revoke: row updated in DB, then cache invalidated.
    rows[0].enabled = false;
    rows[0].revokedAt = new Date();
    svc.invalidate('org-A', 'agent-1');

    const refreshed = await svc.resolve('org-A', 'agent-1');
    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(refreshed?.enabled).toBe(false);
    expect(refreshed?.revokedAt).not.toBeNull();
  });

  it('cache TTL: positive entry expires within ~5s and triggers a refresh', async () => {
    jest.useFakeTimers();
    const { prisma, findFirst } = fakePrisma([
      { id: 'agent-1', organizationId: 'org-A', source: 'internal_mcp', tenantScope: null, enabled: true, revokedAt: null },
    ]);
    const svc = new AgentService(prisma);

    await svc.resolve('org-A', 'agent-1');
    expect(findFirst).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(4_999);
    await svc.resolve('org-A', 'agent-1');
    expect(findFirst).toHaveBeenCalledTimes(1); // still cached

    jest.advanceTimersByTime(2);
    await svc.resolve('org-A', 'agent-1');
    expect(findFirst).toHaveBeenCalledTimes(2); // expired, re-fetched
    jest.useRealTimers();
  });

  it('returns the agent even when disabled or revoked — caller decides what to do', async () => {
    const { prisma } = fakePrisma([
      { id: 'agent-1', organizationId: 'org-A', source: 'internal_mcp', tenantScope: null, enabled: false, revokedAt: new Date() },
    ]);
    const svc = new AgentService(prisma);
    const a = await svc.resolve('org-A', 'agent-1');
    expect(a).not.toBeNull();
    expect(a!.enabled).toBe(false);
    expect(a!.revokedAt).not.toBeNull();
  });
});
