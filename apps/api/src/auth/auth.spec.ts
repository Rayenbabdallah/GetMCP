import 'reflect-metadata';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { mintApiKey, verifyApiKey, hashApiKey } from './api-key.util';

describe('api-key.util', () => {
  it('round-trips: mint → verify true for correct key, false for wrong key', async () => {
    const a = await mintApiKey();
    const b = await mintApiKey();
    expect(await verifyApiKey(a.plaintext, a.hash)).toBe(true);
    expect(await verifyApiKey(b.plaintext, a.hash)).toBe(false);
  });

  it('rejects malformed stored hashes', async () => {
    expect(await verifyApiKey('anything', 'not-a-real-hash')).toBe(false);
    expect(await verifyApiKey('anything', 'bcrypt$abc$def')).toBe(false);
  });

  it('produces 8-char prefix matching the plaintext leading chars', async () => {
    const k = await mintApiKey();
    expect(k.prefix).toHaveLength(8);
    expect(k.plaintext.startsWith(k.prefix)).toBe(true);
  });
});

function makeCtx(headers: Record<string, string>) {
  const req: any = { headers };
  const handler = function handler() {};
  class HandlerClass {}
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => HandlerClass,
    _req: req,
  } as unknown as ExecutionContext & { _req: any };
}

describe('AuthGuard — tenant isolation', () => {
  let guard: AuthGuard;
  let prisma: any;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    prisma = {
      apiKey: {
        findMany: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    guard = new AuthGuard(prisma, reflector);
  });

  it('rejects requests with no Authorization header', async () => {
    const ctx = makeCtx({});
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an unknown API key (no candidates with that prefix)', async () => {
    prisma.apiKey.findMany.mockResolvedValue([]);
    const ctx = makeCtx({ authorization: 'Bearer gmcp_unknownkey' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches auth context for the org that owns the key — and ONLY that org', async () => {
    const orgAKey = await mintApiKey();
    const orgBKey = await mintApiKey();

    // Simulate two orgs whose keys happen to share a prefix collision: the guard
    // must verify the hash, not just the prefix, before accepting.
    prisma.apiKey.findMany.mockImplementation(async ({ where }: any) => {
      const all = [
        { id: 'ka', organizationId: 'org-A', prefix: orgAKey.prefix, hash: orgAKey.hash, revokedAt: null },
        { id: 'kb', organizationId: 'org-B', prefix: orgBKey.prefix, hash: orgBKey.hash, revokedAt: null },
      ];
      return all.filter((k) => k.prefix === where.prefix && k.revokedAt === null);
    });

    // Caller presents org A's key → context resolves to org A.
    const ctxA = makeCtx({ authorization: `Bearer ${orgAKey.plaintext}` });
    await guard.canActivate(ctxA);
    expect((ctxA as any)._req.auth).toEqual({ organizationId: 'org-A', apiKeyId: 'ka' });

    // Caller presents org B's key → context resolves to org B (not A).
    const ctxB = makeCtx({ authorization: `Bearer ${orgBKey.plaintext}` });
    await guard.canActivate(ctxB);
    expect((ctxB as any)._req.auth).toEqual({ organizationId: 'org-B', apiKeyId: 'kb' });

    // Caller presents org A's key but tampered → rejected.
    const tampered = orgAKey.plaintext.slice(0, -1) + 'X';
    const ctxBad = makeCtx({ authorization: `Bearer ${tampered}` });
    await expect(guard.canActivate(ctxBad)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses revoked keys (filtered out in the where clause)', async () => {
    const k = await mintApiKey();
    prisma.apiKey.findMany.mockImplementation(async ({ where }: any) => {
      // Honor the revokedAt: null filter the guard passes
      if (where.revokedAt === null) return [];
      return [{ id: 'k1', organizationId: 'org-X', prefix: k.prefix, hash: k.hash, revokedAt: new Date() }];
    });
    const ctx = makeCtx({ authorization: `Bearer ${k.plaintext}` });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('hashApiKey', () => {
  it('produces different hashes for the same input (random salt)', async () => {
    const h1 = await hashApiKey('same-input');
    const h2 = await hashApiKey('same-input');
    expect(h1).not.toEqual(h2);
    expect(await verifyApiKey('same-input', h1)).toBe(true);
    expect(await verifyApiKey('same-input', h2)).toBe(true);
  });
});
