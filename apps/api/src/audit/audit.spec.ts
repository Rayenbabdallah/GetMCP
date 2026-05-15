import 'reflect-metadata';
import { AuditService } from './audit.service';
import { canonicalJson, computeAuditHash, rowToHashable } from './canonical.util';

// Synchronous import for the recordSafe test below — dynamic import doesn't
// work under the default Jest transformer.

// In-memory Prisma fake good enough to exercise the chain logic.
// Models the bare minimum of what AuditService.record + verifyChain need.
function fakePrisma() {
  const orgs = new Map<string, { lastAuditHash: string; lastAuditSeq: number }>();
  const logs: any[] = [];
  let nextId = 1;

  const tx = {
    organization: {
      findUnique: async ({ where, select }: any) => {
        const o = orgs.get(where.id);
        if (!o) return null;
        return { lastAuditHash: o.lastAuditHash, lastAuditSeq: o.lastAuditSeq };
      },
      update: async ({ where, data }: any) => {
        const o = orgs.get(where.id);
        if (!o) throw new Error('no org');
        if (data.lastAuditHash !== undefined) o.lastAuditHash = data.lastAuditHash;
        if (data.lastAuditSeq !== undefined) o.lastAuditSeq = data.lastAuditSeq;
        return o;
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        const row = { id: `log-${nextId++}`, ...data };
        logs.push(row);
        return row;
      },
      findMany: async ({ where, orderBy, take, cursor, skip }: any) => {
        let rows = logs.filter((r) => r.organizationId === where.organizationId);
        rows.sort((a, b) => a.seq - b.seq);
        if (cursor) {
          const i = rows.findIndex((r) => r.id === cursor.id);
          rows = rows.slice(i + (skip ?? 0));
        }
        if (take) rows = rows.slice(0, take);
        return rows;
      },
    },
  };

  const prisma: any = {
    ...tx,
    $transaction: async (fn: any) => fn(tx),
  };
  return { prisma, orgs, logs };
}

describe('canonicalJson', () => {
  it('orders keys lexicographically and matches across key insertion order', () => {
    const a = canonicalJson({ b: 1, a: { y: 2, x: 1 } });
    const b = canonicalJson({ a: { x: 1, y: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"x":1,"y":2},"b":1}');
  });

  it('serializes arrays in order, handles nulls and booleans', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJson({ x: null, y: true, z: false })).toBe('{"x":null,"y":true,"z":false}');
  });

  it('throws on non-finite numbers', () => {
    expect(() => canonicalJson({ x: NaN })).toThrow();
    expect(() => canonicalJson({ x: Infinity })).toThrow();
  });

  it('throws on unsupported value types', () => {
    expect(() => canonicalJson({ x: () => 0 } as any)).toThrow(/Unsupported/);
    expect(() => canonicalJson({ x: Symbol('s') } as any)).toThrow(/Unsupported/);
  });

  it('canonicalJson handles undefined as null (matches AuditLog nullable convention)', () => {
    expect(canonicalJson(undefined)).toBe('null');
  });
});

describe('AuditService.recordSafe', () => {
  it('does not throw when the underlying record fails', async () => {
    const prisma: any = {
      $transaction: jest.fn().mockRejectedValue(new Error('db down')),
    };
    const svc = new AuditService(prisma);
    // recordSafe is fire-and-forget — it MUST NOT throw or reject the caller.
    expect(() => svc.recordSafe({
      organizationId: 'org-X',
      method: 'GET',
      path: '/x',
      source: 'internal_mcp',
      actionTaken: 'EXECUTED',
      requestBytes: 0,
      latencyMs: 1,
    })).not.toThrow();
    // Yield so the rejected promise is handled by recordSafe's .catch.
    await new Promise((r) => setImmediate(r));
  });
});

describe('AuditService.record + verifyChain', () => {
  it('appends rows with monotonic seq starting at 1, valid chain end-to-end', async () => {
    const { prisma, orgs } = fakePrisma();
    orgs.set('org-A', { lastAuditHash: 'genesis', lastAuditSeq: 0 });
    const audit = new AuditService(prisma);

    const r1 = await audit.record({
      organizationId: 'org-A',
      method: 'GET',
      path: '/v1/charges',
      source: 'internal_mcp',
      actionTaken: 'EXECUTED',
      upstreamStatus: 200,
      requestBytes: 0,
      responseBytes: 1024,
      latencyMs: 12.3,
    });
    const r2 = await audit.record({
      organizationId: 'org-A',
      method: 'POST',
      path: '/v1/refunds',
      source: 'external_mcp',
      reasoning: 'customer requested',
      actionTaken: 'AWAITING_APPROVAL',
      requestBytes: 200,
      latencyMs: 4.5,
    });
    const r3 = await audit.record({
      organizationId: 'org-A',
      method: 'GET',
      path: '/v1/customers',
      source: 'external_mcp',
      tenantId: 'cust_42',
      actionTaken: 'EXECUTED',
      upstreamStatus: 200,
      requestBytes: 0,
      responseBytes: 8000,
      latencyMs: 90,
    });

    expect(r1.seq).toBe(1);
    expect(r2.seq).toBe(2);
    expect(r3.seq).toBe(3);
    expect(orgs.get('org-A')!.lastAuditHash).toBe(r3.hash);
    expect(orgs.get('org-A')!.lastAuditSeq).toBe(3);

    const v = await audit.verifyChain('org-A');
    expect(v).toEqual({ valid: true, rowCount: 3, lastHash: r3.hash });
  });

  it('detects tamper of a row field (hash_mismatch at the tampered seq)', async () => {
    const { prisma, orgs, logs } = fakePrisma();
    orgs.set('org-A', { lastAuditHash: 'genesis', lastAuditSeq: 0 });
    const audit = new AuditService(prisma);

    await audit.record({ organizationId: 'org-A', method: 'GET', path: '/a', source: 'internal_mcp', actionTaken: 'EXECUTED', requestBytes: 0, latencyMs: 1 });
    await audit.record({ organizationId: 'org-A', method: 'GET', path: '/b', source: 'internal_mcp', actionTaken: 'EXECUTED', requestBytes: 0, latencyMs: 1 });
    await audit.record({ organizationId: 'org-A', method: 'GET', path: '/c', source: 'internal_mcp', actionTaken: 'EXECUTED', requestBytes: 0, latencyMs: 1 });

    // Attacker silently rewrites the path on row 2 — its stored hash no longer matches.
    logs.find((r) => r.seq === 2)!.path = '/b-tampered';

    const v = await audit.verifyChain('org-A');
    expect(v).toMatchObject({ valid: false, brokenAtSeq: 2, reason: 'hash_mismatch' });
  });

  it('detects a forged row inserted with the wrong prevHash (prev_hash_mismatch)', async () => {
    const { prisma, orgs, logs } = fakePrisma();
    orgs.set('org-A', { lastAuditHash: 'genesis', lastAuditSeq: 0 });
    const audit = new AuditService(prisma);

    await audit.record({ organizationId: 'org-A', method: 'GET', path: '/a', source: 'internal_mcp', actionTaken: 'EXECUTED', requestBytes: 0, latencyMs: 1 });
    await audit.record({ organizationId: 'org-A', method: 'GET', path: '/b', source: 'internal_mcp', actionTaken: 'EXECUTED', requestBytes: 0, latencyMs: 1 });

    // Attacker swaps row 2's prevHash to point at the wrong predecessor.
    // Re-stamp its self-hash so the row internally looks valid; only the link is wrong.
    const row2 = logs.find((r) => r.seq === 2)!;
    row2.prevHash = 'genesis'; // should be hash of row 1
    row2.hash = computeAuditHash(rowToHashable(row2));

    const v = await audit.verifyChain('org-A');
    expect(v).toMatchObject({ valid: false, brokenAtSeq: 2, reason: 'prev_hash_mismatch' });
  });

  it('detects a deleted row (gap_in_seq)', async () => {
    const { prisma, orgs, logs } = fakePrisma();
    orgs.set('org-A', { lastAuditHash: 'genesis', lastAuditSeq: 0 });
    const audit = new AuditService(prisma);

    await audit.record({ organizationId: 'org-A', method: 'GET', path: '/a', source: 'internal_mcp', actionTaken: 'EXECUTED', requestBytes: 0, latencyMs: 1 });
    await audit.record({ organizationId: 'org-A', method: 'GET', path: '/b', source: 'internal_mcp', actionTaken: 'EXECUTED', requestBytes: 0, latencyMs: 1 });
    await audit.record({ organizationId: 'org-A', method: 'GET', path: '/c', source: 'internal_mcp', actionTaken: 'EXECUTED', requestBytes: 0, latencyMs: 1 });

    // Attacker deletes seq=2.
    const idx = logs.findIndex((r) => r.organizationId === 'org-A' && r.seq === 2);
    logs.splice(idx, 1);

    const v = await audit.verifyChain('org-A');
    expect(v).toMatchObject({ valid: false, brokenAtSeq: 3, reason: 'gap_in_seq' });
  });

  it('per-org chains are independent — tampering org A does not affect org B', async () => {
    const { prisma, orgs, logs } = fakePrisma();
    orgs.set('org-A', { lastAuditHash: 'genesis', lastAuditSeq: 0 });
    orgs.set('org-B', { lastAuditHash: 'genesis', lastAuditSeq: 0 });
    const audit = new AuditService(prisma);

    await audit.record({ organizationId: 'org-A', method: 'GET', path: '/a1', source: 'internal_mcp', actionTaken: 'EXECUTED', requestBytes: 0, latencyMs: 1 });
    await audit.record({ organizationId: 'org-B', method: 'GET', path: '/b1', source: 'internal_mcp', actionTaken: 'EXECUTED', requestBytes: 0, latencyMs: 1 });
    await audit.record({ organizationId: 'org-A', method: 'GET', path: '/a2', source: 'internal_mcp', actionTaken: 'EXECUTED', requestBytes: 0, latencyMs: 1 });
    await audit.record({ organizationId: 'org-B', method: 'GET', path: '/b2', source: 'internal_mcp', actionTaken: 'EXECUTED', requestBytes: 0, latencyMs: 1 });

    // Both orgs see seq=1,2 with their own genesis chain.
    expect(logs.filter((r) => r.organizationId === 'org-A').map((r) => r.seq)).toEqual([1, 2]);
    expect(logs.filter((r) => r.organizationId === 'org-B').map((r) => r.seq)).toEqual([1, 2]);

    // Tamper org A.
    logs.find((r) => r.organizationId === 'org-A' && r.seq === 1)!.path = '/evil';

    expect(await audit.verifyChain('org-A')).toMatchObject({ valid: false });
    expect(await audit.verifyChain('org-B')).toMatchObject({ valid: true, rowCount: 2 });
  });

  it('rowToHashable / computeAuditHash are deterministic for the same input', () => {
    const a = computeAuditHash(rowToHashable({
      organizationId: 'org', seq: 1, timestamp: '2026-01-01T00:00:00.000Z',
      method: 'GET', path: '/x', source: 'internal_mcp', tenantId: null,
      agentId: null, apiKeyId: null, reasoning: null, reason: null,
      actionTaken: 'EXECUTED', upstreamStatus: 200,
      requestBytes: 0, responseBytes: 100, latencyMs: 1.5, prevHash: 'genesis',
    }));
    const b = computeAuditHash(rowToHashable({
      organizationId: 'org', seq: 1, timestamp: '2026-01-01T00:00:00.000Z',
      method: 'GET', path: '/x', source: 'internal_mcp', tenantId: null,
      agentId: null, apiKeyId: null, reasoning: null, reason: null,
      actionTaken: 'EXECUTED', upstreamStatus: 200,
      requestBytes: 0, responseBytes: 100, latencyMs: 1.5, prevHash: 'genesis',
    }));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
