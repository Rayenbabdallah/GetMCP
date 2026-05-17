import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

// Per-agent baseline derived from the audit chain. Two axes today:
//
//   1. Path distribution — how often this agent normally hits each (method, path)
//   2. Volume — average requests per minute over the baseline window
//
// The detector emits a composite score in [0, 1] where higher = more anomalous.
// We deliberately keep the math explainable to auditors — no ML, no opaque
// models. A reviewer should be able to look at a baseline and say "yes, the
// agent normally does X, and this request was Y, which is why the score is Z."

const CACHE_TTL_MS = 5 * 60 * 1000;
const VOLUME_LOOKBACK_MS = 60 * 1000;
const VOLUME_SPIKE_THRESHOLD = 10; // current rate must exceed N× baseline to score 1.0

export interface Baseline {
  organizationId: string;
  agentId: string;
  sampleCount: number;
  windowDays: number;
  pathProbability: Map<string, number>; // key: "METHOD path"
  baselineCallsPerMinute: number;
  computedAt: number;
}

export interface AnomalyScore {
  composite: number;        // max of pathScore and volumeScore
  pathScore: number;        // 0 (normal) → 1 (never-before-seen path)
  volumeScore: number;      // 0 (normal) → 1 (10× baseline rate)
  baselineSampleCount: number;
  reason: string;           // human-readable, audit-quality
}

interface CacheEntry {
  baseline: Baseline;
  expiresAt: number;
}

@Injectable()
export class BehavioralBaselineService {
  private readonly logger = new Logger(BehavioralBaselineService.name);
  private cache = new Map<string, CacheEntry>();

  constructor(private readonly prisma: PrismaService) {}

  // Compute (or return cached) baseline for one agent. Window in days.
  async getBaseline(organizationId: string, agentId: string, windowDays: number): Promise<Baseline> {
    const key = `${organizationId}:${agentId}:${windowDays}`;
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) return cached.baseline;

    const since = new Date(now - windowDays * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.auditLog.findMany({
      where: { organizationId, agentId, timestamp: { gte: since } },
      select: { method: true, path: true },
    });

    const pathCounts = new Map<string, number>();
    for (const r of rows) {
      const k = `${r.method.toUpperCase()} ${r.path}`;
      pathCounts.set(k, (pathCounts.get(k) ?? 0) + 1);
    }
    const total = rows.length;
    const pathProbability = new Map<string, number>();
    for (const [k, c] of pathCounts) pathProbability.set(k, c / total);

    const minutesInWindow = windowDays * 24 * 60;
    const baselineCallsPerMinute = total / minutesInWindow;

    const baseline: Baseline = {
      organizationId,
      agentId,
      sampleCount: total,
      windowDays,
      pathProbability,
      baselineCallsPerMinute,
      computedAt: now,
    };
    this.cache.set(key, { baseline, expiresAt: now + CACHE_TTL_MS });
    return baseline;
  }

  // Score one incoming request against the agent's baseline. The caller decides
  // what action to take based on the composite score and the rule's threshold.
  async scoreRequest(
    organizationId: string,
    agentId: string,
    method: string,
    path: string,
    windowDays: number,
  ): Promise<AnomalyScore> {
    const baseline = await this.getBaseline(organizationId, agentId, windowDays);

    // --- Path score ---
    const key = `${method.toUpperCase()} ${path}`;
    const seen = baseline.pathProbability.get(key) ?? 0;
    // Never seen → 1.0. Rare (< 1% of historical traffic) → 0.5-0.9. Common → ~0.
    let pathScore: number;
    if (seen === 0) pathScore = 1;
    else if (seen >= 0.1) pathScore = 0; // a normal endpoint for this agent
    else pathScore = 1 - seen / 0.1; // graded: rarer = higher

    // --- Volume score ---
    // Count this agent's calls in the last 60s (live query, not cached).
    const sinceVolume = new Date(Date.now() - VOLUME_LOOKBACK_MS);
    const recentCount = await this.prisma.auditLog.count({
      where: { organizationId, agentId, timestamp: { gte: sinceVolume } },
    });
    const currentRatePerMinute = recentCount;
    const spikeMultiplier = baseline.baselineCallsPerMinute === 0
      ? (currentRatePerMinute > 5 ? VOLUME_SPIKE_THRESHOLD : 0) // no history but firing hard = anomaly
      : currentRatePerMinute / baseline.baselineCallsPerMinute;
    const volumeScore = Math.max(0, Math.min(1, spikeMultiplier / VOLUME_SPIKE_THRESHOLD));

    const composite = Math.max(pathScore, volumeScore);

    const reason = composite === 0
      ? `Within baseline (path seen ${(seen * 100).toFixed(1)}% of the time, rate ${currentRatePerMinute}/min vs baseline ${baseline.baselineCallsPerMinute.toFixed(2)}/min)`
      : `Path score ${pathScore.toFixed(2)} (${seen === 0 ? 'never seen' : (seen * 100).toFixed(1) + '% historical'}), volume score ${volumeScore.toFixed(2)} (${currentRatePerMinute}/min vs baseline ${baseline.baselineCallsPerMinute.toFixed(2)}/min)`;

    return {
      composite,
      pathScore,
      volumeScore,
      baselineSampleCount: baseline.sampleCount,
      reason,
    };
  }

  // Test/admin escape hatch.
  invalidate(organizationId: string, agentId: string): void {
    for (const k of this.cache.keys()) {
      if (k.startsWith(`${organizationId}:${agentId}:`)) this.cache.delete(k);
    }
  }
  clearCache(): void { this.cache.clear(); }
}
