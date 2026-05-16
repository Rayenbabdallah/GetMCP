import { ApprovalService } from './approval.service';

// Minimal in-memory Prisma stub covering only the calls ApprovalService makes.
function fakePrisma() {
  const orgs: any = { 'org-A': { slackBotToken: null } };
  const pendings: any[] = [];
  const approvalVotes: any[] = [];
  const rules: any[] = [];
  let nextId = 1;
  let nextVoteId = 1;
  const prisma: any = {
    pendingRequestApproval: {
      create: async ({ data }: any) => {
        const exists = approvalVotes.some(
          (v) =>
            v.pendingRequestId === data.pendingRequestId &&
            v.approverSlackUserId === data.approverSlackUserId,
        );
        if (exists) {
          const e: any = new Error('Unique constraint violation');
          e.code = 'P2002';
          throw e;
        }
        const row = { id: `vote-${nextVoteId++}`, decidedAt: new Date(), ...data };
        approvalVotes.push(row);
        return row;
      },
      count: async ({ where }: any) =>
        approvalVotes.filter(
          (v) =>
            v.pendingRequestId === where.pendingRequestId &&
            (where.decision === undefined || v.decision === where.decision),
        ).length,
    },
    policyRule: {
      findFirst: async ({ where }: any) =>
        rules.find((r) => r.id === where.id && r.organizationId === where.organizationId) ?? null,
    },
    pendingRequest: {
      create: async ({ data }: any) => {
        const row = {
          id: `pend-${nextId++}`,
          status: 'PENDING',
          slackMessageTs: null,
          channel: data.channel ?? null,
          responseStatus: null,
          responseHeaders: null,
          responseBody: null,
          ...data,
        };
        pendings.push(row);
        return row;
      },
      findUnique: async ({ where }: any) => pendings.find((p) => p.id === where.id) ?? null,
      findFirst: async ({ where }: any) =>
        pendings.find((p) => p.id === where.id && p.organizationId === where.organizationId) ?? null,
      findMany: async ({ where }: any) =>
        pendings.filter(
          (p) => p.status === where.status && p.expiresAt < where.expiresAt.lt,
        ),
      update: async ({ where, data }: any) => {
        const p = pendings.find((x) => x.id === where.id);
        if (!p) throw new Error('not found');
        Object.assign(p, data);
        return p;
      },
      updateMany: async ({ where, data }: any) => {
        const matches = pendings.filter((p) => p.id === where.id && p.status === where.status);
        for (const m of matches) Object.assign(m, data);
        return { count: matches.length };
      },
    },
    organization: {
      findUnique: async ({ where }: any) => orgs[where.id] ?? null,
    },
  };
  return { prisma, pendings, orgs, approvalVotes, rules };
}

function fakeProxy(returnValue: any) {
  return { interceptAndExecute: jest.fn().mockResolvedValue(returnValue) };
}

const fakeAudit = { recordSafe: jest.fn() };
const fakeSlack = { postApprovalMessage: jest.fn(), updateMessageDecision: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ApprovalService — state machine', () => {
  it('createPending stores the held request with default 15-minute TTL', async () => {
    const { prisma, pendings } = fakePrisma();
    const svc = new ApprovalService(prisma, fakeProxy({}) as any, fakeAudit as any, fakeSlack as any);

    const before = Date.now();
    await svc.createPending({
      organizationId: 'org-A',
      agentId: 'agent-1',
      agentName: 'agent-1',
      apiKeyId: 'k1',
      method: 'POST',
      path: '/v1/refunds',
      body: { amount: 100 },
      source: 'external_mcp',
      ruleId: 'r1',
      ruleName: 'refund-approval',
      channel: '#ops',
    });

    expect(pendings).toHaveLength(1);
    expect(pendings[0].status).toBe('PENDING');
    const ttl = pendings[0].expiresAt.getTime() - before;
    expect(ttl).toBeGreaterThan(14 * 60 * 1000);
    expect(ttl).toBeLessThan(16 * 60 * 1000);
  });

  it('approve is idempotent — second call is a no-op', async () => {
    const { prisma, pendings } = fakePrisma();
    const proxy = fakeProxy({
      kind: 'proxied',
      status: 200,
      headers: {},
      stream: (async function* () {
        yield Buffer.from('{"ok":true}');
      })(),
    });
    const svc = new ApprovalService(prisma, proxy as any, fakeAudit as any, fakeSlack as any);

    await svc.createPending({
      organizationId: 'org-A',
      agentId: 'agent-1',
      agentName: 'agent-1',
      apiKeyId: 'k1',
      method: 'POST',
      path: '/v1/refunds',
      source: 'external_mcp',
      ruleId: 'r1',
      ruleName: 'r',
      channel: '#ops',
    });

    const first = await svc.approve({
      pendingId: pendings[0].id,
      approverSlackUserId: 'U123',
      approverSlackUserName: 'alice',
    });
    expect(first?.status).toBe('APPROVED');
    expect(proxy.interceptAndExecute).toHaveBeenCalledTimes(1);
    const replayCall = proxy.interceptAndExecute.mock.calls[0][0];
    expect(replayCall.bypassApproval).toBe(true);

    const second = await svc.approve({
      pendingId: pendings[0].id,
      approverSlackUserId: 'U123',
      approverSlackUserName: 'alice',
    });
    expect(second).toBeNull();
    expect(proxy.interceptAndExecute).toHaveBeenCalledTimes(1);
  });

  it('approve captures the upstream response body for the original caller to poll', async () => {
    const { prisma, pendings } = fakePrisma();
    const proxy = fakeProxy({
      kind: 'proxied',
      status: 201,
      headers: { 'content-type': 'application/json' },
      stream: (async function* () {
        yield Buffer.from('{"id":"refund_42","status":"succeeded"}');
      })(),
    });
    const svc = new ApprovalService(prisma, proxy as any, fakeAudit as any, fakeSlack as any);

    await svc.createPending({
      organizationId: 'org-A', agentId: 'a', agentName: 'a', apiKeyId: 'k',
      method: 'POST', path: '/v1/refunds', source: 'external_mcp',
      ruleId: 'r', ruleName: 'r', channel: '#ops',
    });
    await svc.approve({ pendingId: pendings[0].id, approverSlackUserId: 'U', approverSlackUserName: 'alice' });

    expect(pendings[0].responseStatus).toBe(201);
    expect(pendings[0].responseBody).toEqual({ id: 'refund_42', status: 'succeeded' });
  });

  it('approve still records BLOCKED when a non-approval rule trips on replay (e.g. RATE_LIMIT)', async () => {
    const { prisma, pendings } = fakePrisma();
    const proxy = fakeProxy({
      kind: 'policy',
      reason: 'rate limit exceeded',
      status: 'BLOCKED',
      decision: {} as any,
      allowed: false,
    });
    const svc = new ApprovalService(prisma, proxy as any, fakeAudit as any, fakeSlack as any);

    await svc.createPending({
      organizationId: 'org-A', agentId: 'a', agentName: 'a', apiKeyId: 'k',
      method: 'POST', path: '/v1/refunds', source: 'external_mcp',
      ruleId: 'r', ruleName: 'r', channel: '#ops',
    });
    await svc.approve({ pendingId: pendings[0].id, approverSlackUserId: 'U', approverSlackUserName: 'alice' });

    expect(pendings[0].status).toBe('APPROVED'); // human said yes
    expect(pendings[0].responseBody).toEqual({ error: 'rate limit exceeded' }); // but replay was blocked
    const auditCall = (fakeAudit.recordSafe as jest.Mock).mock.calls[0][0];
    expect(auditCall.actionTaken).toBe('BLOCKED');
    expect(auditCall.reason).toMatch(/replay blocked/);
  });

  it('deny writes a BLOCKED audit with the approver identity, no replay', async () => {
    const { prisma, pendings } = fakePrisma();
    const proxy = fakeProxy({});
    const svc = new ApprovalService(prisma, proxy as any, fakeAudit as any, fakeSlack as any);

    await svc.createPending({
      organizationId: 'org-A', agentId: 'a', agentName: 'a', apiKeyId: 'k',
      method: 'POST', path: '/v1/refunds', source: 'external_mcp',
      ruleId: 'r', ruleName: 'r', channel: '#ops',
    });
    const result = await svc.deny({ pendingId: pendings[0].id, approverSlackUserId: 'U', approverSlackUserName: 'bob' }, 'looks suspicious');
    expect(result?.status).toBe('DENIED');
    expect(proxy.interceptAndExecute).not.toHaveBeenCalled();
    const auditCall = (fakeAudit.recordSafe as jest.Mock).mock.calls[0][0];
    expect(auditCall.actionTaken).toBe('BLOCKED');
    expect(auditCall.reason).toMatch(/denied by bob.*suspicious/);
  });

  it('expire on getById fires when row is past TTL', async () => {
    const { prisma, pendings } = fakePrisma();
    const svc = new ApprovalService(prisma, fakeProxy({}) as any, fakeAudit as any, fakeSlack as any);

    await svc.createPending({
      organizationId: 'org-A', agentId: 'a', agentName: 'a', apiKeyId: 'k',
      method: 'POST', path: '/v1/refunds', source: 'external_mcp',
      ruleId: 'r', ruleName: 'r', channel: '#ops',
      ttlMs: 1,
    });
    await new Promise((r) => setTimeout(r, 5));
    const fetched = await svc.getById('org-A', pendings[0].id);
    expect(fetched?.status).toBe('EXPIRED');
    const auditCall = (fakeAudit.recordSafe as jest.Mock).mock.calls[0][0];
    expect(auditCall.reason).toMatch(/expired/);
  });

  it('sweepExpired marks all stale PENDING rows', async () => {
    const { prisma, pendings } = fakePrisma();
    const svc = new ApprovalService(prisma, fakeProxy({}) as any, fakeAudit as any, fakeSlack as any);

    await svc.createPending({ organizationId: 'org-A', agentId: 'a', agentName: 'a', apiKeyId: 'k', method: 'POST', path: '/x', source: 'external_mcp', ruleId: 'r', ruleName: 'r', channel: '#ops', ttlMs: 1 });
    await svc.createPending({ organizationId: 'org-A', agentId: 'a', agentName: 'a', apiKeyId: 'k', method: 'POST', path: '/y', source: 'external_mcp', ruleId: 'r', ruleName: 'r', channel: '#ops', ttlMs: 1 });
    await new Promise((r) => setTimeout(r, 5));
    const n = await svc.sweepExpired();
    expect(n).toBe(2);
    expect(pendings.every((p: any) => p.status === 'EXPIRED')).toBe(true);
  });
});

describe('ApprovalService.approveWithQuorum — quorum + justification', () => {
  function setup(ruleConfig: { requireJustification?: boolean; quorumRequired?: number }) {
    const fakes = fakePrisma();
    const proxy = fakeProxy({
      kind: 'proxied',
      status: 200,
      headers: {},
      stream: (async function* () { yield Buffer.from('{"ok":true}'); })(),
    });
    const svc = new ApprovalService(fakes.prisma, proxy as any, fakeAudit as any, fakeSlack as any);
    return { ...fakes, svc, proxy };
  }

  async function createPending(svc: ApprovalService, rules: any[]) {
    const rule = { id: `rule-${rules.length + 1}`, organizationId: 'org-A', actionConfig: {} };
    rules.push(rule);
    await svc.createPending({
      organizationId: 'org-A',
      agentId: 'agent-1',
      agentName: 'agent-1',
      apiKeyId: 'k1',
      method: 'POST',
      path: '/v1/refunds',
      source: 'external_mcp',
      ruleId: rule.id,
      ruleName: 'refund-approval',
      channel: '#ops',
    });
    return rule;
  }

  it('quorumRequired: 2 — first Approve records vote without replay, second triggers replay', async () => {
    const { svc, pendings, rules, proxy } = setup({});
    const rule = await createPending(svc, rules);
    rule.actionConfig = { quorumRequired: 2 };

    const r1 = await svc.approveWithQuorum({
      pendingId: pendings[0].id,
      approverSlackUserId: 'U1', approverSlackUserName: 'alice',
    });
    expect(r1).toEqual({ kind: 'pending_quorum', have: 1, need: 2 });
    expect(proxy.interceptAndExecute).not.toHaveBeenCalled();
    expect(pendings[0].status).toBe('PENDING');

    const r2 = await svc.approveWithQuorum({
      pendingId: pendings[0].id,
      approverSlackUserId: 'U2', approverSlackUserName: 'bob',
    });
    expect(r2.kind).toBe('decided');
    expect(proxy.interceptAndExecute).toHaveBeenCalledTimes(1);
    expect(pendings[0].status).toBe('APPROVED');
  });

  it('requireJustification: true with empty justification — rejected, no vote recorded', async () => {
    const { svc, pendings, rules, approvalVotes, proxy } = setup({});
    const rule = await createPending(svc, rules);
    rule.actionConfig = { requireJustification: true };

    const r = await svc.approveWithQuorum({
      pendingId: pendings[0].id,
      approverSlackUserId: 'U1', approverSlackUserName: 'alice',
      justification: '   ',
    });
    expect(r).toEqual({ kind: 'rejected_missing_justification' });
    expect(approvalVotes).toHaveLength(0);
    expect(proxy.interceptAndExecute).not.toHaveBeenCalled();
    expect(pendings[0].status).toBe('PENDING');

    // Same approver retrying with real justification succeeds.
    const r2 = await svc.approveWithQuorum({
      pendingId: pendings[0].id,
      approverSlackUserId: 'U1', approverSlackUserName: 'alice',
      justification: 'customer asked, ticket CS-321',
    });
    expect(r2.kind).toBe('decided');
    expect(approvalVotes[0].justification).toBe('customer asked, ticket CS-321');
  });

  it('one approver cannot double-vote — second click returns already_voted', async () => {
    const { svc, pendings, rules, approvalVotes, proxy } = setup({});
    const rule = await createPending(svc, rules);
    rule.actionConfig = { quorumRequired: 2 };

    await svc.approveWithQuorum({
      pendingId: pendings[0].id,
      approverSlackUserId: 'U1', approverSlackUserName: 'alice',
    });
    expect(approvalVotes).toHaveLength(1);

    const r = await svc.approveWithQuorum({
      pendingId: pendings[0].id,
      approverSlackUserId: 'U1', approverSlackUserName: 'alice',
    });
    expect(r).toEqual({ kind: 'already_voted', have: 1, need: 2 });
    expect(approvalVotes).toHaveLength(1);   // no new row
    expect(proxy.interceptAndExecute).not.toHaveBeenCalled();
    expect(pendings[0].status).toBe('PENDING');
  });
});
