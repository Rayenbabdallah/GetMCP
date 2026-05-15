// Validates the x-agent-reasoning header. Reject empty, too-short, or boilerplate
// values that defeat the purpose of audit context.
//
// "test", "because", "idk" are common attacker / lazy-developer placeholders.
// Length floor of 10 chars is a deliberately low bar — we want this to push
// callers toward concrete reasons without becoming a writing test.

const BANNED = new Set([
  'test',
  'testing',
  'because',
  'reason',
  'idk',
  'why not',
  'na',
  'n/a',
  'todo',
  'fix',
  'fixme',
  'debug',
  'debugging',
  'just doing it',
  'placeholder',
]);

const MIN_LENGTH = 10;

export function isValidReasoning(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length < MIN_LENGTH) return false;
  if (BANNED.has(trimmed.toLowerCase())) return false;
  return true;
}

export function reasoningRejectionReason(text: string | null | undefined): string {
  if (!text || !text.trim()) return 'reasoning is empty';
  if (text.trim().length < MIN_LENGTH) return `reasoning must be at least ${MIN_LENGTH} chars`;
  return 'reasoning is a generic placeholder';
}
