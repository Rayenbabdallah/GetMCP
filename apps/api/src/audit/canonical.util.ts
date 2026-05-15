import { createHash } from 'crypto';

// Stable JSON: keys sorted, no whitespace. Required for reproducible hashing
// across processes, languages, and serializer versions.
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot canonicalize non-finite number');
    return JSON.stringify(value);
  }
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return (
      '{' +
      keys
        .map((k) => JSON.stringify(k) + ':' + canonicalJson((value as Record<string, unknown>)[k]))
        .join(',') +
      '}'
    );
  }
  throw new Error(`Unsupported value of type ${typeof value}`);
}

// The exact set of fields that participate in the audit hash. Adding a field
// to AuditLog without adding it here means the chain will not detect tampering
// of that field — keep these in sync.
export interface HashablePayload {
  organizationId: string;
  seq: number;
  timestamp: string; // ISO 8601
  method: string;
  path: string;
  source: string;
  tenantId: string | null;
  agentId: string | null;
  apiKeyId: string | null;
  reasoning: string | null;
  reason: string | null;
  actionTaken: string;
  upstreamStatus: number | null;
  requestBytes: number;
  responseBytes: number | null;
  latencyMs: number;
  prevHash: string;
}

export function computeAuditHash(payload: HashablePayload): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

export function rowToHashable(row: any): HashablePayload {
  return {
    organizationId: row.organizationId,
    seq: row.seq,
    timestamp: new Date(row.timestamp).toISOString(),
    method: row.method,
    path: row.path,
    source: row.source,
    tenantId: row.tenantId ?? null,
    agentId: row.agentId ?? null,
    apiKeyId: row.apiKeyId ?? null,
    reasoning: row.reasoning ?? null,
    reason: row.reason ?? null,
    actionTaken: row.actionTaken,
    upstreamStatus: row.upstreamStatus ?? null,
    requestBytes: row.requestBytes,
    responseBytes: row.responseBytes ?? null,
    latencyMs: row.latencyMs,
    prevHash: row.prevHash,
  };
}
