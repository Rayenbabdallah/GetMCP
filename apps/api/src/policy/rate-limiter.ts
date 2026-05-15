import { Injectable } from '@nestjs/common';

export interface ConsumeResult {
  allowed: boolean;
  retryAfterMs: number;
}

interface Bucket {
  tokens: number;
  lastRefill: number;
}

// In-memory token bucket. Single-instance — multi-instance deployments need
// Redis (or another shared store) for global limits. The interface here is
// designed to be drop-in replaceable; see CHECKLIST §6.
@Injectable()
export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  consume(key: string, limit: number, windowMs: number, cost = 1): ConsumeResult {
    if (limit <= 0 || windowMs <= 0) return { allowed: true, retryAfterMs: 0 };
    const now = Date.now();
    const refillPerMs = limit / windowMs;

    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: limit, lastRefill: now };
      this.buckets.set(key, b);
    }

    const elapsed = now - b.lastRefill;
    b.tokens = Math.min(limit, b.tokens + elapsed * refillPerMs);
    b.lastRefill = now;

    if (b.tokens >= cost) {
      b.tokens -= cost;
      return { allowed: true, retryAfterMs: 0 };
    }

    const need = cost - b.tokens;
    return { allowed: false, retryAfterMs: Math.ceil(need / refillPerMs) };
  }

  // Test/admin escape hatch.
  reset(): void {
    this.buckets.clear();
  }
}
