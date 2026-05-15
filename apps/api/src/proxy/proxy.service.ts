import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import axios, { AxiosError, AxiosResponse } from 'axios';
import type { Readable } from 'stream';
import { PrismaService } from '../prisma.service';
import { decryptSecret } from '../crypto.util';
import { PolicyService } from '../policy/policy.service';
import { Decision } from '../policy/policy.engine';

export interface AgentRequest {
  method: string;
  path: string;
  source: 'internal_mcp' | 'external_mcp';
  tenantId?: string;
  headers?: Record<string, string | undefined>;
  query?: Record<string, any>;
  body?: any;
  organizationId: string;
  agentId?: string | null;
  // Set true when replaying an approved request — skips MUTATION_APPROVAL rules
  // but still honors BLOCK / AUDIT / RATE_LIMIT.
  bypassApproval?: boolean;
}

export interface PolicyOutcome {
  kind: 'policy';
  allowed: false;
  status: 'BLOCKED' | 'AWAITING_APPROVAL';
  reason: string;
  decision: Decision;
}

export interface ProxiedResponse {
  kind: 'proxied';
  status: number;
  headers: Record<string, string>;
  stream: Readable;
}

export type ProxyOutcome = PolicyOutcome | ProxiedResponse;

const STRIP_REQUEST_HEADERS = new Set([
  'authorization',
  'host',
  'content-length',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'cookie',
  'x-tenant-id',
  'x-agent-id',
  'x-agent-source',
  'x-agent-reasoning',
  'x-request-id',
]);

const STRIP_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  async interceptAndExecute(req: AgentRequest): Promise<ProxyOutcome> {
    const { method, path, source, headers, organizationId } = req;
    if (!organizationId) {
      throw new HttpException(
        { allowed: false, status: 'BLOCKED', reason: 'Missing organization context' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    this.logger.log(`Intercepting [${method}] ${path} from ${source} (org=${organizationId})`);
    const startTime = process.hrtime();

    const decision = await this.policy.evaluate({
      organizationId,
      method,
      path,
      source,
      agentId: req.agentId ?? null,
      tenantId: req.tenantId ?? null,
      reasoning: headers?.['x-agent-reasoning'] ?? null,
      bypassApproval: req.bypassApproval,
    });

    if (decision.kind === 'block') {
      this.logger.warn(`Blocked by Rule [${decision.rule.name}]: ${decision.reason}`);
      throw new HttpException(
        { allowed: false, status: 'BLOCKED', reason: decision.reason },
        HttpStatus.FORBIDDEN,
      );
    }
    if (decision.kind === 'rate_limited') {
      this.logger.warn(
        `Rate-limited by Rule [${decision.rule.name}], retry in ${decision.retryAfterMs}ms`,
      );
      throw new HttpException(
        {
          allowed: false,
          status: 'BLOCKED',
          reason: `Rate limit exceeded for rule "${decision.rule.name}"`,
          retryAfterMs: decision.retryAfterMs,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (decision.kind === 'awaiting_approval') {
      // bypassApproval already filters MUTATION_APPROVAL in the engine; if we
      // still see this kind here, the request genuinely needs approval.
      this.logger.warn(
        `Intercepted by Rule [${decision.rule.name}] - notifying ${decision.channel}`,
      );
      return {
        kind: 'policy',
        allowed: false,
        status: 'AWAITING_APPROVAL',
        reason: decision.reason,
        decision,
      };
    }

    // decision.kind === 'allow'
    const proxied = await this.forwardUpstream(req);

    const diff = process.hrtime(startTime);
    const latencyMs = (diff[0] * 1e9 + diff[1]) / 1e6;
    this.logger.log(`Policy + upstream completed in ${latencyMs.toFixed(2)}ms (status=${proxied.status})`);

    return proxied;
  }

  private async forwardUpstream(req: AgentRequest): Promise<ProxiedResponse> {
    const org = await this.prisma.organization.findUnique({
      where: { id: req.organizationId },
      select: { upstreamBaseUrl: true, upstreamAuthHeader: true, upstreamTimeoutMs: true },
    });

    if (!org?.upstreamBaseUrl) {
      throw new HttpException(
        {
          allowed: false,
          status: 'BLOCKED',
          reason:
            'No upstream configured for this organization. Set upstreamBaseUrl via PATCH /orgs/me.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const url = joinUrl(org.upstreamBaseUrl, req.path);
    const forwardHeaders = this.buildForwardHeaders(req.headers, org.upstreamAuthHeader);

    try {
      const response: AxiosResponse<Readable> = await axios.request<Readable>({
        url,
        method: req.method as any,
        headers: forwardHeaders,
        params: req.query,
        data: req.body,
        timeout: org.upstreamTimeoutMs,
        responseType: 'stream',
        validateStatus: () => true,
        maxRedirects: 0,
      });

      return {
        kind: 'proxied',
        status: response.status,
        headers: this.filterResponseHeaders(response.headers as Record<string, any>),
        stream: response.data,
      };
    } catch (err) {
      const ax = err as AxiosError;
      if (ax.code === 'ECONNABORTED' || ax.code === 'ETIMEDOUT') {
        this.logger.warn(`Upstream timeout after ${org.upstreamTimeoutMs}ms: ${url}`);
        throw new HttpException(
          { allowed: false, status: 'BLOCKED', reason: 'Upstream timeout' },
          HttpStatus.GATEWAY_TIMEOUT,
        );
      }
      this.logger.error(`Upstream connection error to ${url}: ${ax.message}`);
      throw new HttpException(
        { allowed: false, status: 'BLOCKED', reason: `Upstream unreachable: ${ax.message}` },
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  private buildForwardHeaders(
    incoming: Record<string, string | undefined> | undefined,
    encryptedAuthHeader: string | null,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    if (incoming) {
      for (const [k, v] of Object.entries(incoming)) {
        if (!v) continue;
        if (STRIP_REQUEST_HEADERS.has(k.toLowerCase())) continue;
        out[k] = v;
      }
    }
    if (encryptedAuthHeader) {
      out['Authorization'] = decryptSecret(encryptedAuthHeader);
    }
    return out;
  }

  private filterResponseHeaders(input: Record<string, any>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(input)) {
      if (STRIP_RESPONSE_HEADERS.has(k.toLowerCase())) continue;
      if (v === undefined || v === null) continue;
      out[k] = Array.isArray(v) ? v.join(', ') : String(v);
    }
    return out;
  }

}

export function joinUrl(base: string, path: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}
