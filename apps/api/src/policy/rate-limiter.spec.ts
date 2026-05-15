import { RateLimiter } from './rate-limiter';

describe('RateLimiter (token bucket)', () => {
  let rl: RateLimiter;
  beforeEach(() => {
    rl = new RateLimiter();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('allows up to `limit` requests immediately, then 429s with a sane retryAfterMs', () => {
    for (let i = 0; i < 5; i++) {
      const r = rl.consume('k', 5, 1000);
      expect(r.allowed).toBe(true);
    }
    const denied = rl.consume('k', 5, 1000);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(1000);
  });

  it('refills proportionally over time', () => {
    for (let i = 0; i < 5; i++) rl.consume('k', 5, 1000);
    expect(rl.consume('k', 5, 1000).allowed).toBe(false);
    jest.advanceTimersByTime(200); // refill 1 token (5/1000 * 200ms = 1)
    expect(rl.consume('k', 5, 1000).allowed).toBe(true);
    expect(rl.consume('k', 5, 1000).allowed).toBe(false);
  });

  it('keys are independent', () => {
    for (let i = 0; i < 5; i++) rl.consume('k1', 5, 1000);
    expect(rl.consume('k1', 5, 1000).allowed).toBe(false);
    expect(rl.consume('k2', 5, 1000).allowed).toBe(true);
  });

  it('caps at limit (no infinite refill while idle)', () => {
    rl.consume('k', 5, 1000);
    jest.advanceTimersByTime(60_000); // way more than window
    // bucket is back to full but cannot exceed limit
    for (let i = 0; i < 5; i++) expect(rl.consume('k', 5, 1000).allowed).toBe(true);
    expect(rl.consume('k', 5, 1000).allowed).toBe(false);
  });

  it('ignores zero/negative limit (always allow)', () => {
    expect(rl.consume('k', 0, 1000).allowed).toBe(true);
    expect(rl.consume('k', -1, 1000).allowed).toBe(true);
    expect(rl.consume('k', 5, 0).allowed).toBe(true);
  });
});
