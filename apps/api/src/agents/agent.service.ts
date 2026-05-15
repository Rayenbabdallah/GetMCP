import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export type ResolvedAgent = {
  id: string;
  organizationId: string;
  source: string;
  tenantScope: string | null;
  enabled: boolean;
  revokedAt: Date | null;
};

interface CacheEntry {
  agent: ResolvedAgent | null; // negative caching: null means "verified absent"
  expiresAt: number;
}

// 5s TTL — matches the SLA in CHECKLIST §5 ("revocation takes effect within 5s").
// Single-instance only; multi-instance deployments need a Redis pub/sub
// invalidation channel — see open items in §5.
const TTL_MS = 5_000;

@Injectable()
export class AgentService {
  private cache = new Map<string, CacheEntry>();

  constructor(private readonly prisma: PrismaService) {}

  async resolve(organizationId: string, agentId: string): Promise<ResolvedAgent | null> {
    const key = `${organizationId}:${agentId}`;
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) return cached.agent;

    const row = await this.prisma.agentIdentity.findFirst({
      where: { id: agentId, organizationId },
      select: {
        id: true,
        organizationId: true,
        source: true,
        tenantScope: true,
        enabled: true,
        revokedAt: true,
      },
    });

    const agent: ResolvedAgent | null = row ? row : null;
    this.cache.set(key, { agent, expiresAt: now + TTL_MS });

    if (agent) {
      // best-effort, don't block the request
      this.prisma.agentIdentity
        .update({ where: { id: agent.id }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined);
    }

    return agent;
  }

  invalidate(organizationId: string, agentId: string): void {
    this.cache.delete(`${organizationId}:${agentId}`);
  }

  // Test/admin escape hatch.
  clearCache(): void {
    this.cache.clear();
  }
}
