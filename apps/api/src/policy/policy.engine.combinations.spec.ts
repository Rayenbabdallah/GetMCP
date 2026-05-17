// Cross-rule interaction tests for the policy engine.
// The single-rule cases live in policy.engine.spec.ts. These tests cover the
// interactions that are easiest to silently break when adding rule types,
// changing precedence, or refactoring the loop.

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

const ctx: EvalContext = {
  organizationId: 'org-1',
  method: 'POST',
  path: '/v1/refunds',
  source: 'external_mcp',
  agentId: 'agent-1',
  tenantId: 'tenant-1',
  reasoning: 'customer-initiated refund per CS-321',
};

describe('rule interactions', () => {
  let rl: RateLimiter;
  beforeEach(() => {
    rl = new RateLimiter();
  });

  it('AUDIT runs first (priority 10), then ALLOWLIST short-circuits BLOCK', () => {
    const rules = [
      rule({ id: 'audit', priority: 10, ruleType: 'AUDIT', targetPath: '*' }),
      rule({ id: 'allow', priority: 50, ruleType: 'ALLOWLIST', targetMethod: 'POST', targetPath: '/v1/refunds' }),
      rule({ id: 'block', priority: 100, ruleType: 'BLOCK', targetMethod: 'POST', targetPath: '/v1/refunds' }),
    ];
    const d = evaluate(rules, ctx, rl);
    expect(d.kind).toBe('allow');
    expect(d.trace.find((t) => t.ruleId === 'allow')?.outcome).toBe('matched_allow');
    // BLOCK should not appear because ALLOWLIST short-circuited.
    expect(d.trace.find((t) => t.ruleId === 'block')).toBeUndefined();
  });

  it('AUDIT failure terminates before ALLOWLIST gets a chance', () => {
    const rules = [
      rule({ id: 'audit', priority: 10, ruleType: 'AUDIT', targetPath: '*' }),
      rule({ id: 'allow', priority: 50, ruleType: 'ALLOWLIST', targetMethod: 'POST', targetPath: '/v1/refunds' }),
    ];
    const d = evaluate(rules, { ...ctx, reasoning: 'test' }, rl);
    expect(d.kind).toBe('block');
    if (d.kind !== 'block') return;
    expect(d.rule.id).toBe('audit');
  });

  it('BLOCK at lower priority beats MUTATION_APPROVAL at higher priority', () => {
    const rules = [
      rule({ id: 'mut', priority: 200, ruleType: 'MUTATION_APPROVAL', targetMethod: 'POST', targetPath: '/v1/refunds' }),
      rule({ id: 'blk', priority: 50, ruleType: 'BLOCK', targetMethod: 'POST', targetPath: '/v1/refunds' }),
    ];
    const d = evaluate(rules, ctx, rl);
    expect(d.kind).toBe('block');
    if (d.kind !== 'block') return;
    expect(d.rule.id).toBe('blk');
  });

  it('RATE_LIMIT consumed THEN MUTATION_APPROVAL fires (rate limit is precondition)', () => {
    const rules = [
      rule({
        id: 'rl', priority: 50, ruleType: 'RATE_LIMIT', targetMethod: '*', targetPath: '*',
        actionConfig: { limit: 5, windowMs: 60_000, scope: 'agent+tenant' },
      }),
      rule({ id: 'mut', priority: 100, ruleType: 'MUTATION_APPROVAL', targetMethod: 'POST', targetPath: '/v1/refunds', actionConfig: { channel: '#ops' } }),
    ];
    const d = evaluate(rules, ctx, rl);
    expect(d.kind).toBe('awaiting_approval');
    // Trace shows RATE_LIMIT consumed a token and continued.
    const rlTrace = d.trace.find((t) => t.ruleId === 'rl');
    expect(rlTrace?.detail).toMatch(/consumed 1 token/);
  });

  it('RATE_LIMIT exhaustion blocks before MUTATION_APPROVAL gets a chance', () => {
    const rules = [
      rule({
        id: 'rl', priority: 50, ruleType: 'RATE_LIMIT', targetMethod: '*', targetPath: '*',
        actionConfig: { limit: 2, windowMs: 60_000, scope: 'agent+tenant' },
      }),
      rule({ id: 'mut', priority: 100, ruleType: 'MUTATION_APPROVAL', targetMethod: 'POST', targetPath: '/v1/refunds' }),
    ];
    expect(evaluate(rules, ctx, rl).kind).toBe('awaiting_approval');
    expect(evaluate(rules, ctx, rl).kind).toBe('awaiting_approval');
    const denied = evaluate(rules, ctx, rl);
    expect(denied.kind).toBe('rate_limited');
    if (denied.kind !== 'rate_limited') return;
    expect(denied.rule.id).toBe('rl');
  });

  it('ALLOWLIST does NOT bypass an upstream AUDIT rule that ran first', () => {
    // AUDIT at priority 10 runs first; if reasoning is bad, it blocks
    // immediately and ALLOWLIST never runs.
    const rules = [
      rule({ id: 'audit', priority: 10, ruleType: 'AUDIT', targetPath: '*' }),
      rule({ id: 'allow', priority: 50, ruleType: 'ALLOWLIST', targetMethod: 'POST', targetPath: '/v1/refunds' }),
    ];
    const d = evaluate(rules, { ...ctx, reasoning: null }, rl);
    expect(d.kind).toBe('block');
    if (d.kind !== 'block') return;
    expect(d.rule.id).toBe('audit');
  });

  it('source filter: MUTATION_APPROVAL and RATE_LIMIT skip for internal_mcp', () => {
    const rules = [
      rule({ id: 'mut', priority: 50, ruleType: 'MUTATION_APPROVAL', targetMethod: 'POST', targetPath: '/v1/refunds', actionConfig: { channel: '#ops' } }),
      rule({ id: 'rl', priority: 100, ruleType: 'RATE_LIMIT', targetMethod: '*', targetPath: '*', actionConfig: { limit: 1, windowMs: 60_000 } }),
    ];
    const d = evaluate(rules, { ...ctx, source: 'internal_mcp' }, rl);
    expect(d.kind).toBe('allow');
    // Both should have a "not_applicable_to_source" trace entry.
    expect(d.trace.find((t) => t.ruleId === 'mut')?.outcome).toBe('not_applicable_to_source');
    expect(d.trace.find((t) => t.ruleId === 'rl')?.outcome).toBe('not_applicable_to_source');
  });

  it('source filter: BLOCK applies to BOTH internal and external', () => {
    const rules = [
      rule({ id: 'blk', priority: 50, ruleType: 'BLOCK', targetMethod: 'DELETE', targetPath: '/v1/customers/:id' }),
    ];
    const dExt = evaluate(rules, { ...ctx, source: 'external_mcp', method: 'DELETE', path: '/v1/customers/abc' }, rl);
    const dInt = evaluate(rules, { ...ctx, source: 'internal_mcp', method: 'DELETE', path: '/v1/customers/abc' }, rl);
    expect(dExt.kind).toBe('block');
    expect(dInt.kind).toBe('block');
  });

  it('priority tiebreak by createdAt — earlier rule wins', () => {
    const earlier = rule({ id: 'A', priority: 100, ruleType: 'BLOCK', targetMethod: '*', targetPath: '*', name: 'first', createdAt: new Date('2026-01-01') });
    const later = rule({ id: 'B', priority: 100, ruleType: 'BLOCK', targetMethod: '*', targetPath: '*', name: 'second', createdAt: new Date('2026-02-01') });
    const sorted = sortRules([later, earlier]);
    expect(sorted[0].id).toBe('A');

    const d = evaluate([later, earlier], ctx, rl);
    expect(d.kind).toBe('block');
    if (d.kind !== 'block') return;
    expect(d.rule.id).toBe('A');
  });

  it('bypassApproval skips MUTATION_APPROVAL across multiple matching approval rules', () => {
    const rules = [
      rule({ id: 'mut1', priority: 10, ruleType: 'MUTATION_APPROVAL', targetMethod: 'POST', targetPath: '/v1/refunds', actionConfig: { channel: '#a' } }),
      rule({ id: 'mut2', priority: 20, ruleType: 'MUTATION_APPROVAL', targetMethod: 'POST', targetPath: '*', actionConfig: { channel: '#b' } }),
      rule({ id: 'audit', priority: 30, ruleType: 'AUDIT', targetPath: '*' }),
    ];
    // Without bypass: first MUTATION_APPROVAL wins.
    expect(evaluate(rules, ctx, rl).kind).toBe('awaiting_approval');
    // With bypass: both MUTATION_APPROVAL rules are skipped, AUDIT runs and passes (reasoning is valid).
    const d = evaluate(rules, { ...ctx, bypassApproval: true }, rl);
    expect(d.kind).toBe('allow');
    expect(d.trace.filter((t) => t.ruleType === 'MUTATION_APPROVAL').every((t) => t.detail?.includes('bypassed'))).toBe(true);
  });

  it('non-matching rules never fire — no false positives even with broad targets', () => {
    const rules = [
      rule({ id: 'narrow', priority: 50, ruleType: 'BLOCK', targetMethod: 'DELETE', targetPath: '/v1/admin' }),
    ];
    const d = evaluate(rules, { ...ctx, method: 'GET', path: '/v1/charges' }, rl);
    expect(d.kind).toBe('allow');
    expect(d.trace[0].matched).toBe(false);
  });
});

describe('BEHAVIORAL_ANOMALY rule type', () => {
  let rl: RateLimiter;
  beforeEach(() => { rl = new RateLimiter(); });

  function anomalyRule(over: Partial<PolicyRuleLite> = {}): PolicyRuleLite {
    return rule({
      ruleType: 'BEHAVIORAL_ANOMALY',
      targetMethod: '*',
      targetPath: '*',
      priority: 40,
      actionConfig: { sensitivity: 0.9, minBaselineSamples: 50, onAnomaly: 'block', baselineWindowDays: 7 },
      ...over,
    });
  }

  it('bypasses when baseline sample count is below minBaselineSamples', () => {
    const d = evaluate(
      [anomalyRule()],
      { ...ctx, anomalyScore: 0.99, anomalyBaselineSampleCount: 10, anomalyReason: 'new agent' },
      rl,
    );
    expect(d.kind).toBe('allow');
    expect(d.trace[0].detail).toMatch(/insufficient baseline/);
  });

  it('allows when score is below sensitivity threshold', () => {
    const d = evaluate(
      [anomalyRule()],
      { ...ctx, anomalyScore: 0.5, anomalyBaselineSampleCount: 200 },
      rl,
    );
    expect(d.kind).toBe('allow');
    expect(d.trace[0].detail).toMatch(/within baseline/);
  });

  it('blocks when score >= sensitivity and onAnomaly: block', () => {
    const d = evaluate(
      [anomalyRule({ actionConfig: { sensitivity: 0.9, minBaselineSamples: 50, onAnomaly: 'block', baselineWindowDays: 7 } })],
      { ...ctx, anomalyScore: 0.97, anomalyBaselineSampleCount: 200, anomalyReason: 'never seen DELETE /admin/users' },
      rl,
    );
    expect(d.kind).toBe('block');
    if (d.kind !== 'block') return;
    expect(d.reason).toMatch(/Behavioural anomaly.*never seen/);
  });

  it('audit_only mode logs but does not block', () => {
    const d = evaluate(
      [anomalyRule({ actionConfig: { sensitivity: 0.9, minBaselineSamples: 50, onAnomaly: 'audit_only', baselineWindowDays: 7 } })],
      { ...ctx, anomalyScore: 0.97, anomalyBaselineSampleCount: 200 },
      rl,
    );
    expect(d.kind).toBe('allow');
    expect(d.trace[0].detail).toMatch(/audit_only/);
  });

  it('approval mode escalates to awaiting_approval with the channel from config', () => {
    const d = evaluate(
      [anomalyRule({ actionConfig: { sensitivity: 0.9, minBaselineSamples: 50, onAnomaly: 'approval', baselineWindowDays: 7, approverChannel: '#sec-ops' } })],
      { ...ctx, anomalyScore: 0.97, anomalyBaselineSampleCount: 200, anomalyReason: 'volume spike' },
      rl,
    );
    expect(d.kind).toBe('awaiting_approval');
    if (d.kind !== 'awaiting_approval') return;
    expect(d.channel).toBe('#sec-ops');
  });

  it('skips for internal_mcp source (external_mcp only)', () => {
    const d = evaluate(
      [anomalyRule()],
      { ...ctx, source: 'internal_mcp', anomalyScore: 0.99, anomalyBaselineSampleCount: 200 },
      rl,
    );
    expect(d.kind).toBe('allow');
    expect(d.trace[0].outcome).toBe('not_applicable_to_source');
  });
});
