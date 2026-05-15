import { evaluate, EvalContext, PolicyRuleLite, sortRules } from './policy.engine';
import { RateLimiter } from './rate-limiter';

function rule(over: Partial<PolicyRuleLite>): PolicyRuleLite {
  return {
    id: over.id ?? 'r-' + Math.random().toString(36).slice(2, 8),
    name: over.name ?? 'rule',
    description: over.description ?? 'desc',
    ruleType: over.ruleType ?? 'BLOCK',
    targetMethod: over.targetMethod ?? '*',
    targetPath: over.targetPath ?? '*',
    actionConfig: over.actionConfig ?? {},
    priority: over.priority ?? 100,
    createdAt: over.createdAt ?? new Date(),
  };
}

const baseCtx: EvalContext = {
  organizationId: 'org-1',
  method: 'POST',
  path: '/v1/refunds',
  source: 'external_mcp',
  agentId: 'agent-1',
  tenantId: 'tenant-1',
  reasoning: 'customer-initiated refund per CS-321',
};

describe('sortRules', () => {
  it('orders by priority asc, then createdAt asc', () => {
    const a = rule({ id: 'a', priority: 100, createdAt: new Date('2026-01-01') });
    const b = rule({ id: 'b', priority: 50, createdAt: new Date('2026-01-02') });
    const c = rule({ id: 'c', priority: 50, createdAt: new Date('2026-01-01') });
    expect(sortRules([a, b, c]).map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('evaluate', () => {
  let rl: RateLimiter;
  beforeEach(() => {
    rl = new RateLimiter();
  });

  it('allows when no rules match', () => {
    const d = evaluate([], baseCtx, rl);
    expect(d.kind).toBe('allow');
  });

  it('BLOCK is terminal — wins over later AWAITING_APPROVAL', () => {
    const rules = [
      rule({ id: 'mut', priority: 200, ruleType: 'MUTATION_APPROVAL', targetMethod: 'POST', targetPath: '/v1/refunds' }),
      rule({ id: 'blk', priority: 50, ruleType: 'BLOCK', targetMethod: 'POST', targetPath: '/v1/refunds' }),
    ];
    const d = evaluate(rules, baseCtx, rl);
    expect(d.kind).toBe('block');
    if (d.kind !== 'block') return;
    expect(d.rule.id).toBe('blk');
  });

  it('ALLOWLIST short-circuits subsequent BLOCK', () => {
    const rules = [
      rule({ id: 'allow', priority: 10, ruleType: 'ALLOWLIST', targetMethod: 'POST', targetPath: '/v1/refunds' }),
      rule({ id: 'blk', priority: 100, ruleType: 'BLOCK', targetMethod: 'POST', targetPath: '/v1/refunds' }),
    ];
    const d = evaluate(rules, baseCtx, rl);
    expect(d.kind).toBe('allow');
  });

  it('AUDIT requires non-trivial reasoning', () => {
    const r = rule({ ruleType: 'AUDIT', targetMethod: '*', targetPath: '*' });
    const ok = evaluate([r], baseCtx, rl);
    expect(ok.kind).toBe('allow');

    const bad = evaluate([r], { ...baseCtx, reasoning: 'placeholder' }, rl);
    expect(bad.kind).toBe('block');
    if (bad.kind !== 'block') return;
    expect(bad.reason).toMatch(/placeholder/);

    const tooShort = evaluate([r], { ...baseCtx, reasoning: 'test' }, rl);
    expect(tooShort.kind).toBe('block');

    const empty = evaluate([r], { ...baseCtx, reasoning: null }, rl);
    expect(empty.kind).toBe('block');
  });

  it('MUTATION_APPROVAL only fires for external_mcp', () => {
    const r = rule({
      ruleType: 'MUTATION_APPROVAL',
      targetMethod: 'POST',
      targetPath: '/v1/refunds',
      actionConfig: { channel: '#finance' },
    });
    const internal = evaluate([r], { ...baseCtx, source: 'internal_mcp' }, rl);
    expect(internal.kind).toBe('allow');

    const external = evaluate([r], baseCtx, rl);
    expect(external.kind).toBe('awaiting_approval');
    if (external.kind !== 'awaiting_approval') return;
    expect(external.channel).toBe('#finance');
  });

  it('RATE_LIMIT consumes tokens and returns 429-ish decision when exhausted', () => {
    const r = rule({
      ruleType: 'RATE_LIMIT',
      targetMethod: '*',
      targetPath: '*',
      actionConfig: { limit: 2, windowMs: 60_000, scope: 'agent+tenant' },
    });
    expect(evaluate([r], baseCtx, rl).kind).toBe('allow');
    expect(evaluate([r], baseCtx, rl).kind).toBe('allow');
    const denied = evaluate([r], baseCtx, rl);
    expect(denied.kind).toBe('rate_limited');
    if (denied.kind !== 'rate_limited') return;
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  it('RATE_LIMIT requires tenantId — missing → block', () => {
    const r = rule({
      ruleType: 'RATE_LIMIT',
      targetMethod: '*',
      targetPath: '*',
      actionConfig: { limit: 5, windowMs: 1000 },
    });
    const d = evaluate([r], { ...baseCtx, tenantId: null }, rl);
    expect(d.kind).toBe('block');
  });

  it('RATE_LIMIT buckets are independent across tenants', () => {
    const r = rule({
      ruleType: 'RATE_LIMIT',
      targetMethod: '*',
      targetPath: '*',
      actionConfig: { limit: 1, windowMs: 60_000, scope: 'agent+tenant' },
    });
    expect(evaluate([r], { ...baseCtx, tenantId: 'A' }, rl).kind).toBe('allow');
    expect(evaluate([r], { ...baseCtx, tenantId: 'A' }, rl).kind).toBe('rate_limited');
    expect(evaluate([r], { ...baseCtx, tenantId: 'B' }, rl).kind).toBe('allow');
  });

  it('path templates work — old String.includes regression guard', () => {
    const r = rule({
      ruleType: 'BLOCK',
      targetMethod: 'POST',
      targetPath: '/v1/refunds',
    });
    // /v1/refunds-undo must NOT trigger the /v1/refunds rule.
    const d = evaluate([r], { ...baseCtx, path: '/v1/refunds-undo' }, rl);
    expect(d.kind).toBe('allow');
  });

  it('produces a trace entry for every rule examined', () => {
    const rules = [
      rule({ id: 'r1', ruleType: 'BLOCK', targetPath: '/never-matches' }),
      rule({ id: 'r2', ruleType: 'AUDIT', targetMethod: '*', targetPath: '*' }),
    ];
    const d = evaluate(rules, baseCtx, rl);
    expect(d.trace).toHaveLength(2);
    expect(d.trace[0]).toMatchObject({ ruleId: 'r1', matched: false });
    expect(d.trace[1]).toMatchObject({ ruleId: 'r2', matched: true });
  });
});
