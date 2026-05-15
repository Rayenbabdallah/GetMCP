import 'reflect-metadata';
import { randomBytes } from 'crypto';
import { AuditService } from './audit.service';
import { computeAuditHash, rowToHashable } from './canonical.util';

// Property-style test for the audit chain. We assert two invariants:
//
//   1. CHAIN HOLDS — for any sequence of N random valid inserts, verifyChain
//      returns valid: true with rowCount == N and the head hash matching the
//      most recent row's hash.
//
//   2. ANY MUTATION IS DETECTED — pick a random row, randomly tamper exactly
//      one field, expect verifyChain to fail at that row's seq.
//
// This is the "tamper-evident" claim made in the bible reduced to a runnable
// property — if either of these stops being true, the §4 moat is broken.

function fakePrisma() {
  const orgs = new Map<string, { lastAuditHash: string; lastAuditSeq: number }>();
  const logs: any[] = [];
  let nextId = 1;
  const tx = {
    organization: {
      findUnique: async ({ where }: any) => orgs.get(where.id) ?? null,
      update: async ({ where, data }: any) => {
        const o = orgs.get(where.id)!;
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
      findMany: async ({ where, take, cursor, skip }: any) => {
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
  const prisma: any = { ...tx, $transaction: async (fn: any) => fn(tx) };
  return { prisma, orgs, logs };
}

const ACTIONS = ['EXECUTED', 'BLOCKED', 'AWAITING_APPROVAL', 'INCOMPLETE'] as const;
const SOURCES = ['internal_mcp', 'external_mcp', 'system'] as const;
const PATHS = ['/v1/charges', '/v1/refunds', '/v1/customers/abc', '/admin/users', '/v2/items/{id}'];
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInput(orgId: string) {
  return {
    organizationId: orgId,
    apiKeyId: 'k-' + randomBytes(4).toString('hex'),
    agentId: Math.random() < 0.7 ? 'agent-' + randomBytes(4).toString('hex') : null,
    method: pick(METHODS),
    path: pick(PATHS),
    source: pick(SOURCES) as 'internal_mcp' | 'external_mcp' | 'system',
    tenantId: Math.random() < 0.5 ? 'tenant-' + randomBytes(2).toString('hex') : null,
    reasoning: Math.random() < 0.5 ? randomBytes(20).toString('hex') : null,
    reason: Math.random() < 0.3 ? 'random-reason-' + Math.floor(Math.random() * 1000) : null,
    actionTaken: pick(ACTIONS) as any,
    upstreamStatus: Math.random() < 0.6 ? Math.floor(Math.random() * 500) + 100 : null,
    requestBytes: Math.floor(Math.random() * 10_000),
    responseBytes: Math.random() < 0.7 ? Math.floor(Math.random() * 50_000) : null,
    latencyMs: Math.random() * 1000,
  };
}

const N = 200;

describe('audit chain property tests', () => {
  it('chain holds across 200 random inserts (single org)', async () => {
    const { prisma, orgs } = fakePrisma();
    orgs.set('org-prop', { lastAuditHash: 'genesis', lastAuditSeq: 0 });
    const audit = new AuditService(prisma);

    let lastHash = 'genesis';
    for (let i = 0; i < N; i++) {
      const r = await audit.record(randomInput('org-prop'));
      lastHash = r.hash;
      expect(r.seq).toBe(i + 1);
    }

    const v = await audit.verifyChain('org-prop');
    expect(v).toEqual({ valid: true, rowCount: N, lastHash });
  });

  it('chain holds across two orgs interleaved (no cross-contamination)', async () => {
    const { prisma, orgs } = fakePrisma();
    orgs.set('org-A', { lastAuditHash: 'genesis', lastAuditSeq: 0 });
    orgs.set('org-B', { lastAuditHash: 'genesis', lastAuditSeq: 0 });
    const audit = new AuditService(prisma);

    for (let i = 0; i < 50; i++) {
      await audit.record(randomInput('org-A'));
      await audit.record(randomInput('org-B'));
    }

    const va = await audit.verifyChain('org-A');
    const vb = await audit.verifyChain('org-B');
    expect(va.valid).toBe(true);
    expect(vb.valid).toBe(true);
    if (va.valid) expect(va.rowCount).toBe(50);
    if (vb.valid) expect(vb.rowCount).toBe(50);
  });

  it('detects a single random field tamper (50 trials, every trial detected)', async () => {
    for (let trial = 0; trial < 50; trial++) {
      const { prisma, orgs, logs } = fakePrisma();
      orgs.set('org-tamper', { lastAuditHash: 'genesis', lastAuditSeq: 0 });
      const audit = new AuditService(prisma);
      for (let i = 0; i < 20; i++) await audit.record(randomInput('org-tamper'));

      // Pick a victim row and a victim field.
      const victim = logs[Math.floor(Math.random() * logs.length)];
      const fields = ['method', 'path', 'reasoning', 'reason', 'actionTaken', 'requestBytes', 'responseBytes', 'latencyMs'] as const;
      const field = pick(fields);
      // Mutate it to a different value of the same type.
      switch (field) {
        case 'method': victim[field] = victim[field] === 'GET' ? 'DELETE' : 'GET'; break;
        case 'requestBytes': victim[field] = (victim[field] || 0) + 1; break;
        case 'responseBytes': victim[field] = (victim[field] || 0) + 1; break;
        case 'latencyMs': victim[field] = victim[field] + 0.001; break;
        default: victim[field] = 'tampered-' + trial; break;
      }

      const v = await audit.verifyChain('org-tamper');
      expect(v.valid).toBe(false);
      if (!v.valid) {
        // The detection must point at the victim row's seq OR a downstream
        // row (because once one row's hash changes, prevHash links break).
        // The first failure is always at or after the victim seq.
        expect(v.brokenAtSeq).toBeGreaterThanOrEqual(victim.seq);
      }
    }
  });

  it('detects a row deletion as gap_in_seq', async () => {
    for (let trial = 0; trial < 20; trial++) {
      const { prisma, orgs, logs } = fakePrisma();
      orgs.set('org-del', { lastAuditHash: 'genesis', lastAuditSeq: 0 });
      const audit = new AuditService(prisma);
      for (let i = 0; i < 20; i++) await audit.record(randomInput('org-del'));

      const victimIdx = Math.floor(Math.random() * 18) + 1; // not seq=1, not last
      const victim = logs.find((r) => r.seq === victimIdx)!;
      logs.splice(logs.indexOf(victim), 1);

      const v = await audit.verifyChain('org-del');
      expect(v.valid).toBe(false);
      if (!v.valid) expect(v.reason).toBe('gap_in_seq');
    }
  });

  it('detects a forged row (correct self-hash, wrong prevHash) as prev_hash_mismatch', async () => {
    const { prisma, orgs, logs } = fakePrisma();
    orgs.set('org-forge', { lastAuditHash: 'genesis', lastAuditSeq: 0 });
    const audit = new AuditService(prisma);
    for (let i = 0; i < 5; i++) await audit.record(randomInput('org-forge'));

    // Attacker rewrites row 3's prevHash and re-stamps its self-hash so the
    // row internally validates — but the link is wrong.
    const r3 = logs.find((r) => r.seq === 3)!;
    r3.prevHash = 'genesis';
    r3.hash = computeAuditHash(rowToHashable(r3));

    const v = await audit.verifyChain('org-forge');
    expect(v.valid).toBe(false);
    if (!v.valid) {
      expect(v.brokenAtSeq).toBe(3);
      expect(v.reason).toBe('prev_hash_mismatch');
    }
  });
});
