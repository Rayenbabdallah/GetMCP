import 'reflect-metadata';
import { HttpStatus } from '@nestjs/common';
import { Readable } from 'stream';
import axios from 'axios';
import { randomBytes } from 'crypto';
import { ProxyService, joinUrl, AgentRequest } from './proxy.service';
import { encryptSecret } from '../crypto.util';
import { Decision } from '../policy/policy.engine';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function makeService(orgRow: any, decision: Decision) {
  const prisma: any = {
    organization: { findUnique: jest.fn().mockResolvedValue(orgRow) },
  };
  const policy: any = {
    evaluate: jest.fn().mockResolvedValue(decision),
  };
  return { service: new ProxyService(prisma, policy), prisma, policy };
}

function streamOf(body: string): Readable {
  return Readable.from([Buffer.from(body)]);
}

const baseReq: AgentRequest = {
  organizationId: 'org-1',
  method: 'GET',
  path: '/v1/charges',
  source: 'internal_mcp',
  headers: {},
};

const allowDecision: Decision = { kind: 'allow', trace: [] };

describe('joinUrl', () => {
  it('joins base + path with single slash', () => {
    expect(joinUrl('https://api.stripe.com', '/v1/charges')).toBe('https://api.stripe.com/v1/charges');
    expect(joinUrl('https://api.stripe.com/', '/v1/charges')).toBe('https://api.stripe.com/v1/charges');
    expect(joinUrl('https://api.stripe.com', 'v1/charges')).toBe('https://api.stripe.com/v1/charges');
  });
});

describe('ProxyService policy → response shape', () => {
  beforeEach(() => {
    process.env.KEY_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    jest.clearAllMocks();
  });

  it('block decision → 403 HttpException, never calls upstream', async () => {
    const block: Decision = {
      kind: 'block',
      reason: 'Policy Violation: nope',
      rule: { id: 'r', name: 'r', description: 'd', ruleType: 'BLOCK', targetMethod: '*', targetPath: '*', actionConfig: {}, priority: 0, createdAt: new Date() },
      trace: [],
    };
    const { service } = makeService({ upstreamBaseUrl: 'https://x' }, block);
    await expect(service.interceptAndExecute(baseReq)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
    expect(mockedAxios.request).not.toHaveBeenCalled();
  });

  it('rate_limited decision → 429 HttpException with retryAfterMs in body', async () => {
    const rl: Decision = {
      kind: 'rate_limited',
      retryAfterMs: 750,
      rule: { id: 'r', name: 'r', description: 'd', ruleType: 'RATE_LIMIT', targetMethod: '*', targetPath: '*', actionConfig: {}, priority: 0, createdAt: new Date() },
      trace: [],
    };
    const { service } = makeService({ upstreamBaseUrl: 'https://x' }, rl);
    await expect(service.interceptAndExecute(baseReq)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      response: expect.objectContaining({ retryAfterMs: 750 }),
    });
    expect(mockedAxios.request).not.toHaveBeenCalled();
  });

  it('awaiting_approval decision → PolicyOutcome, never calls upstream', async () => {
    const aa: Decision = {
      kind: 'awaiting_approval',
      reason: 'needs approval',
      channel: '#ops',
      rule: { id: 'r', name: 'r', description: 'd', ruleType: 'MUTATION_APPROVAL', targetMethod: 'POST', targetPath: '/x', actionConfig: {}, priority: 0, createdAt: new Date() },
      trace: [],
    };
    const { service } = makeService({ upstreamBaseUrl: 'https://x' }, aa);
    const out = await service.interceptAndExecute(baseReq);
    expect(out.kind).toBe('policy');
    if (out.kind !== 'policy') return;
    expect(out.status).toBe('AWAITING_APPROVAL');
    expect(mockedAxios.request).not.toHaveBeenCalled();
  });

  it('allow → forwards upstream with status passthrough', async () => {
    const { service } = makeService(
      { upstreamBaseUrl: 'https://api.example.com', upstreamAuthHeader: null, upstreamTimeoutMs: 5000 },
      allowDecision,
    );
    mockedAxios.request.mockResolvedValue({
      status: 404,
      headers: { 'content-type': 'application/json' },
      data: streamOf('{"error":"not_found"}'),
    } as any);

    const out = await service.interceptAndExecute(baseReq);
    expect(out.kind).toBe('proxied');
    if (out.kind !== 'proxied') return;
    expect(out.status).toBe(404);
    expect(mockedAxios.request).toHaveBeenCalledTimes(1);
  });
});

describe('ProxyService.forwardUpstream', () => {
  beforeEach(() => {
    process.env.KEY_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    jest.clearAllMocks();
  });

  it('rejects with 400 when org has no upstreamBaseUrl', async () => {
    const { service } = makeService({ upstreamBaseUrl: null }, allowDecision);
    await expect(service.interceptAndExecute(baseReq)).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('strips internal/hop-by-hop headers and never forwards the caller Authorization', async () => {
    const { service } = makeService(
      { upstreamBaseUrl: 'https://api.example.com', upstreamAuthHeader: null, upstreamTimeoutMs: 5000 },
      allowDecision,
    );
    mockedAxios.request.mockResolvedValue({ status: 200, headers: {}, data: streamOf('') } as any);

    await service.interceptAndExecute({
      ...baseReq,
      headers: {
        authorization: 'Bearer caller-token-MUST-NOT-LEAK',
        'x-agent-id': 'agent-1',
        'x-agent-source': 'internal_mcp',
        'x-agent-reasoning': 'debugging',
        'x-tenant-id': 'tenant-A',
        'x-request-id': 'abc',
        host: 'getmcp.example.com',
        'content-length': '99',
        'transfer-encoding': 'chunked',
        accept: 'application/json',
        'x-custom-passthrough': 'keep-me',
      },
    });

    const sent = mockedAxios.request.mock.calls[0][0]!.headers as Record<string, string>;
    expect(sent.authorization).toBeUndefined();
    expect(sent['x-agent-id']).toBeUndefined();
    expect(sent['x-agent-source']).toBeUndefined();
    expect(sent['x-agent-reasoning']).toBeUndefined();
    expect(sent['x-tenant-id']).toBeUndefined();
    expect(sent['x-request-id']).toBeUndefined();
    expect(sent.host).toBeUndefined();
    expect(sent['content-length']).toBeUndefined();
    expect(sent['transfer-encoding']).toBeUndefined();
    expect(sent.accept).toBe('application/json');
    expect(sent['x-custom-passthrough']).toBe('keep-me');
  });

  it('injects the decrypted upstream Authorization header', async () => {
    const stored = encryptSecret('Bearer sk_test_real_upstream_token');
    const { service } = makeService(
      { upstreamBaseUrl: 'https://api.example.com', upstreamAuthHeader: stored, upstreamTimeoutMs: 5000 },
      allowDecision,
    );
    mockedAxios.request.mockResolvedValue({ status: 200, headers: {}, data: streamOf('') } as any);

    await service.interceptAndExecute(baseReq);

    const sent = mockedAxios.request.mock.calls[0][0]!.headers as Record<string, string>;
    expect(sent['Authorization']).toBe('Bearer sk_test_real_upstream_token');
  });

  it('maps timeouts to 504, not 500', async () => {
    const { service } = makeService(
      { upstreamBaseUrl: 'https://api.example.com', upstreamAuthHeader: null, upstreamTimeoutMs: 100 },
      allowDecision,
    );
    const err: any = new Error('timeout of 100ms exceeded');
    err.code = 'ECONNABORTED';
    err.isAxiosError = true;
    mockedAxios.request.mockRejectedValue(err);

    await expect(service.interceptAndExecute(baseReq)).rejects.toMatchObject({
      status: HttpStatus.GATEWAY_TIMEOUT,
    });
  });

  it('maps connection errors to 502 Bad Gateway', async () => {
    const { service } = makeService(
      { upstreamBaseUrl: 'https://api.example.com', upstreamAuthHeader: null, upstreamTimeoutMs: 5000 },
      allowDecision,
    );
    const err: any = new Error('connect ECONNREFUSED');
    err.code = 'ECONNREFUSED';
    err.isAxiosError = true;
    mockedAxios.request.mockRejectedValue(err);

    await expect(service.interceptAndExecute(baseReq)).rejects.toMatchObject({
      status: HttpStatus.BAD_GATEWAY,
    });
  });

  it('strips hop-by-hop response headers from the pass-through', async () => {
    const { service } = makeService(
      { upstreamBaseUrl: 'https://api.example.com', upstreamAuthHeader: null, upstreamTimeoutMs: 5000 },
      allowDecision,
    );
    mockedAxios.request.mockResolvedValue({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'transfer-encoding': 'chunked',
        connection: 'keep-alive',
        'x-stripe-id': 'req_abc',
      },
      data: streamOf('{"ok":true}'),
    } as any);

    const out = await service.interceptAndExecute(baseReq);
    if (out.kind !== 'proxied') throw new Error();
    expect(out.headers['content-type']).toBe('application/json');
    expect(out.headers['x-stripe-id']).toBe('req_abc');
    expect(out.headers['transfer-encoding']).toBeUndefined();
    expect(out.headers['connection']).toBeUndefined();
  });
});
