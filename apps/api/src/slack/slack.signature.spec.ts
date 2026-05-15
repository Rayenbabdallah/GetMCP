import { createHmac } from 'crypto';
import { verifySlackSignature } from './slack.signature';

const SECRET = 'shhh-very-secret';

function signed(rawBody: string, ts: number) {
  const base = `v0:${ts}:${rawBody}`;
  return 'v0=' + createHmac('sha256', SECRET).update(base).digest('hex');
}

describe('verifySlackSignature', () => {
  const now = 1_700_000_000;

  it('accepts a valid signature within the 5-minute window', () => {
    const body = 'payload=%7B%22type%22%3A%22block_actions%22%7D';
    const ts = now;
    const sig = signed(body, ts);
    expect(verifySlackSignature(body, String(ts), sig, SECRET, now)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const ts = now;
    const sig = signed('payload=%7B%22type%22%3A%22block_actions%22%7D', ts);
    const tampered = 'payload=%7B%22type%22%3A%22evil%22%7D';
    expect(verifySlackSignature(tampered, String(ts), sig, SECRET, now)).toBe(false);
  });

  it('rejects a wrong signing secret', () => {
    const body = 'x=y';
    const sig = signed(body, now);
    expect(verifySlackSignature(body, String(now), sig, 'different-secret', now)).toBe(false);
  });

  it('rejects timestamps outside the 5-minute window', () => {
    const body = 'x=y';
    const oldTs = now - 60 * 6;
    const sig = signed(body, oldTs);
    expect(verifySlackSignature(body, String(oldTs), sig, SECRET, now)).toBe(false);

    const futureTs = now + 60 * 6;
    const sig2 = signed(body, futureTs);
    expect(verifySlackSignature(body, String(futureTs), sig2, SECRET, now)).toBe(false);
  });

  it('rejects missing headers / empty inputs', () => {
    expect(verifySlackSignature('x=y', undefined, 'sig', SECRET, now)).toBe(false);
    expect(verifySlackSignature('x=y', String(now), undefined, SECRET, now)).toBe(false);
    expect(verifySlackSignature('x=y', String(now), 'sig', '', now)).toBe(false);
    expect(verifySlackSignature('x=y', 'not-a-number', 'sig', SECRET, now)).toBe(false);
  });

  it('uses constant-time comparison (no length-leak short-circuit)', () => {
    const body = 'x=y';
    const ts = now;
    expect(verifySlackSignature(body, String(ts), 'v0=short', SECRET, now)).toBe(false);
    expect(
      verifySlackSignature(body, String(ts), 'v0=' + 'a'.repeat(64), SECRET, now),
    ).toBe(false);
  });
});
