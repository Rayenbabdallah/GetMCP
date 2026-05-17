import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Decision, EvalContext, evaluate, PolicyRuleLite } from './policy.engine';
import { RateLimiter } from './rate-limiter';
import { MetricsService } from '../metrics/metrics.service';
import { BehavioralBaselineService } from './baseline.service';

interface CacheEntry {
  rules: PolicyRuleLite[];
  expiresAt: number;
}

const TTL_MS = 5_000;

@Injectable()
export class PolicyService {
  private cache = new Map<string, CacheEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimiter: RateLimiter,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly baseline?: BehavioralBaselineService,
  ) {}

  async getActiveRules(organizationId: string): Promise<PolicyRuleLite[]> {
    const now = Date.now();
    const cached = this.cache.get(organizationId);
    if (cached && cached.expiresAt > now) return cached.rules;

    const rules = await this.prisma.policyRule.findMany({
      where: { organizationId, isActive: true },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
    const lite: PolicyRuleLite[] = rules.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      ruleType: r.ruleType,
      targetMethod: r.targetMethod,
      targetPath: r.targetPath,
      actionConfig: r.actionConfig,
      priority: r.priority,
      createdAt: r.createdAt,
    }));
    this.cache.set(organizationId, { rules: lite, expiresAt: now + TTL_MS });
    return lite;
  }

  invalidate(organizationId: string): void {
    this.cache.delete(organizationId);
  }

  clearCache(): void {
    this.cache.clear();
  }

  async evaluate(ctx: EvalContext): Promise<Decision> {
    const rules = await this.getActiveRules(ctx.organizationId);

    // Precompute anomaly score if any active rule is BEHAVIORAL_ANOMALY and we
    // have an agentId to score. The engine is sync — all I/O happens here.
    const needsAnomaly = rules.some((r) => r.ruleType === 'BEHAVIORAL_ANOMALY');
    let enriched: EvalContext = ctx;
    if (needsAnomaly && ctx.agentId && this.baseline) {
      // Pick the largest baselineWindowDays among matching rules; cache key is per-window.
      const window = rules
        .filter((r) => r.ruleType === 'BEHAVIORAL_ANOMALY')
        .map((r) => {
          const cfg = r.actionConfig as any;
          return Number.isInteger(cfg?.baselineWindowDays) && cfg.baselineWindowDays > 0
            ? cfg.baselineWindowDays
            : 7;
        })
        .reduce((a, b) => Math.max(a, b), 7);

      try {
        const score = await this.baseline.scoreRequest(
          ctx.organizationId,
          ctx.agentId,
          ctx.method,
          ctx.path,
          window,
        );
        enriched = {
          ...ctx,
          anomalyScore: score.composite,
          anomalyReason: score.reason,
          anomalyBaselineSampleCount: score.baselineSampleCount,
        };
      } catch (err) {
        // Anomaly scoring failure must never block traffic — log and continue
        // as if the rule weren't there (the bypass branch in the engine will
        // kick in because sampleCount stays undefined → 0 < minSamples).
        // eslint-disable-next-line no-console
        console.warn('[PolicyService] anomaly scoring failed:', err);
      }
    }

    const decision = evaluate(rules, enriched, this.rateLimiter);
    this.metrics?.recordPolicy(decision.kind);
    return decision;
  }
}
