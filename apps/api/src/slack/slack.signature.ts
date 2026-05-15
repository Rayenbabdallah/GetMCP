import { createHmac, timingSafeEqual } from 'crypto';

// Verifies a Slack request signature per https://api.slack.com/authentication/verifying-requests-from-slack
//
// Slack sends two headers: X-Slack-Signature and X-Slack-Request-Timestamp.
// The signature is "v0=" + HMAC-SHA256(signingSecret, "v0:" + ts + ":" + rawBody).
// The timestamp must be within ±5 minutes (replay protection).
//
// `rawBody` MUST be the exact bytes Slack sent — not a re-serialized object.
// See SlackController for the raw-body capture.

const TOLERANCE_SEC = 60 * 5;

export function verifySlackSignature(
  rawBody: string,
  timestamp: string | undefined,
  signature: string | undefined,
  signingSecret: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!timestamp || !signature || !signingSecret) return false;
  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(nowSec - ts) > TOLERANCE_SEC) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const expected = 'v0=' + createHmac('sha256', signingSecret).update(base).digest('hex');

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
