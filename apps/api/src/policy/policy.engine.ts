import { methodMatches, pathMatches } from './path-match.util';
import { isValidReasoning, reasoningRejectionReason } from './reasoning.util';
import { RateLimiter } from './rate-limiter';

export type RuleType =
  | 'ALLOWLIST'
  | 'BLOCK'
  | 'AUDIT'
  | 'RATE_LIMIT'
  | 'MUTATION_APPROVAL';

export interface PolicyRuleLite {
  id: string;
  name: string;
  description: string;
  ruleType: string;
  targetMethod: string;
  targetPath: string;
  actionConfig: any;
  priority: number;
  createdAt: Date;
}

export interface EvalContext {
  method: string;
  path: string;
  source: 'internal_mcp' | 'external_mcp';
  organizationId: string;
  agentId?: string | null;
  tenantId?: string | null;
  reasoning?: string | null;
  // True when replaying a request that has already received human approval —
  // MUTATION_APPROVAL rules are skipped, all other rules still apply.
  bypassApproval?: boolean;
}

// Each step taken during evaluation, useful for the dry-run endpoint.
export interface EvaluationTrace {
  ruleId: string;
  ruleName: string;
  ruleType: string;
  matched: boolean;
  outcome:
    | 'skipped'
    | 'matched_allow'
    | 'matched_block'
    | 'matched_awaiting_approval'
    | 'matched_rate_limited'
    | 'matched_audit_ok'
    | 'matched_audit_rejected'
    | 'not_applicable_to_source';
  detail?: string;
}

export type Decision =
  | { kind: 'allow'; trace: EvaluationTrace[] }
  | { kind: 'block'; rule: PolicyRuleLite; reason: string; trace: EvaluationTrace[] }
  | {
      kind: 'awaiting_approval';
      rule: PolicyRuleLite;
      reason: string;
      channel: string;
      trace: EvaluationTrace[];
    }
  | {
      kind: 'rate_limited';
      rule: PolicyRuleLite;
      retryAfterMs: number;
      trace: EvaluationTrace[];
    };

// MUTATION_APPROVAL and RATE_LIMIT only apply to external agents — internal
// is god-mode by design. BLOCK / ALLOWLIST / AUDIT apply universally.
const EXTERNAL_ONLY: ReadonlySet<string> = new Set(['MUTATION_APPROVAL', 'RATE_LIMIT']);

export function sortRules(rules: PolicyRuleLite[]): PolicyRuleLite[] {
  return [...rules].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

export function evaluate(
  rules: PolicyRuleLite[],
  ctx: EvalContext,
  rateLimiter: RateLimiter,
): Decision {
  const sorted = sortRules(rules);
  const trace: EvaluationTrace[] = [];

  for (const rule of sorted) {
    const baseMatch =
      methodMatches(rule.targetMethod, ctx.method) && pathMatches(rule.targetPath, ctx.path);
    if (!baseMatch) {
      trace.push({
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: rule.ruleType,
        matched: false,
        outcome: 'skipped',
      });
      continue;
    }

    if (rule.ruleType === 'MUTATION_APPROVAL' && ctx.bypassApproval) {
      trace.push({
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: rule.ruleType,
        matched: true,
        outcome: 'skipped',
        detail: 'bypassed (already approved)',
      });
      continue;
    }

    if (EXTERNAL_ONLY.has(rule.ruleType) && ctx.source !== 'external_mcp') {
      trace.push({
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: rule.ruleType,
        matched: true,
        outcome: 'not_applicable_to_source',
        detail: `${rule.ruleType} only evaluates for external_mcp`,
      });
      continue;
    }

    switch (rule.ruleType as RuleType) {
      case 'ALLOWLIST': {
        trace.push({
          ruleId: rule.id,
          ruleName: rule.name,
          ruleType: rule.ruleType,
          matched: true,
          outcome: 'matched_allow',
          detail: 'short-circuit allow',
        });
        return { kind: 'allow', trace };
      }
      case 'BLOCK': {
        trace.push({
          ruleId: rule.id,
          ruleName: rule.name,
          ruleType: rule.ruleType,
          matched: true,
          outcome: 'matched_block',
        });
        return {
          kind: 'block',
          rule,
          reason: `Policy Violation: ${rule.description}`,
          trace,
        };
      }
      case 'AUDIT': {
        if (!isValidReasoning(ctx.reasoning)) {
          const detail = reasoningRejectionReason(ctx.reasoning);
          trace.push({
            ruleId: rule.id,
            ruleName: rule.name,
            ruleType: rule.ruleType,
            matched: true,
            outcome: 'matched_audit_rejected',
            detail,
          });
          return {
            kind: 'block',
            rule,
            reason: `Policy Violation (${rule.name}): ${detail}`,
            trace,
          };
        }
        trace.push({
          ruleId: rule.id,
          ruleName: rule.name,
          ruleType: rule.ruleType,
          matched: true,
          outcome: 'matched_audit_ok',
        });
        continue;
      }
      case 'MUTATION_APPROVAL': {
        const cfg = rule.actionConfig ?? {};
        const channel = typeof cfg.channel === 'string' ? cfg.channel : '#ops';
        trace.push({
          ruleId: rule.id,
          ruleName: rule.name,
          ruleType: rule.ruleType,
          matched: true,
          outcome: 'matched_awaiting_approval',
          detail: `would notify ${channel}`,
        });
        return {
          kind: 'awaiting_approval',
          rule,
          reason: `Policy Engine intercepted execution: ${rule.description}`,
          channel,
          trace,
        };
      }
      case 'RATE_LIMIT': {
        if (!ctx.tenantId) {
          // Tenant isolation precondition — same semantic as before, but now
          // surfaced as a deterministic block with a clear reason.
          trace.push({
            ruleId: rule.id,
            ruleName: rule.name,
            ruleType: rule.ruleType,
            matched: true,
            outcome: 'matched_block',
            detail: 'missing tenant scope',
          });
          return {
            kind: 'block',
            rule,
            reason: `Policy Violation (${rule.name}): missing x-tenant-id`,
            trace,
          };
        }
        const cfg = rule.actionConfig ?? {};
        const limit = Number.isInteger(cfg.limit) ? cfg.limit : 60;
        const windowMs = Number.isInteger(cfg.windowMs) ? cfg.windowMs : 60_000;
        const scope = typeof cfg.scope === 'string' ? cfg.scope : 'agent+tenant';
        const key = buildBucketKey(scope, rule.id, ctx);
        const result = rateLimiter.consume(key, limit, windowMs);
        if (!result.allowed) {
          trace.push({
            ruleId: rule.id,
            ruleName: rule.name,
            ruleType: rule.ruleType,
            matched: true,
            outcome: 'matched_rate_limited',
            detail: `over ${limit}/${windowMs}ms; retry in ${result.retryAfterMs}ms`,
          });
          return {
            kind: 'rate_limited',
            rule,
            retryAfterMs: result.retryAfterMs,
            trace,
          };
        }
        trace.push({
          ruleId: rule.id,
          ruleName: rule.name,
          ruleType: rule.ruleType,
          matched: true,
          outcome: 'matched_audit_ok', // re-use "matched, no action"
          detail: `consumed 1 token (${limit}/${windowMs}ms)`,
        });
        continue;
      }
      default:
        trace.push({
          ruleId: rule.id,
          ruleName: rule.name,
          ruleType: rule.ruleType,
          matched: true,
          outcome: 'skipped',
          detail: `unknown rule type ${rule.ruleType}`,
        });
        continue;
    }
  }

  return { kind: 'allow', trace };
}

function buildBucketKey(scope: string, ruleId: string, ctx: EvalContext): string {
  const parts: string[] = [ruleId, ctx.organizationId];
  if (scope.includes('agent')) parts.push(ctx.agentId ?? 'no-agent');
  if (scope.includes('tenant')) parts.push(ctx.tenantId ?? 'no-tenant');
  return parts.join('|');
}
