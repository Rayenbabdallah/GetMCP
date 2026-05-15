import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Decision, EvalContext, evaluate, PolicyRuleLite } from './policy.engine';
import { RateLimiter } from './rate-limiter';

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
    return evaluate(rules, ctx, this.rateLimiter);
  }
}
