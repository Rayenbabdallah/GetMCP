import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import axios, { AxiosError, AxiosResponse } from 'axios';
import type { Readable } from 'stream';
import { PrismaService } from '../prisma.service';
import { decryptSecret } from '../crypto.util';

export interface AgentRequest {
  method: string;
  path: string;
  source: 'internal_mcp' | 'external_mcp';
  tenantId?: string;
  headers?: Record<string, string | undefined>;
  query?: Record<string, any>;
  body?: any;
  organizationId: string;
}

// Decision returned to the caller without touching the upstream.
export interface PolicyOutcome {
  kind: 'policy';
  allowed: false;
  status: 'BLOCKED' | 'AWAITING_APPROVAL';
  reason: string;
}

// Faithful pass-through of the upstream response. The controller writes
// `status` + `headers` + pipes `stream` into res.
export interface ProxiedResponse {
  kind: 'proxied';
  status: number;
  headers: Record<string, string>;
  stream: Readable;
}

export type ProxyOutcome = PolicyOutcome | ProxiedResponse;

// Headers we never forward upstream — either GetMCP-internal context, hop-by-hop
// per RFC 7230, or auth that must not leak to a third party.
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
  'x-agent-source',
  'x-agent-reasoning',
  'x-request-id',
]);

// Hop-by-hop headers we never echo back to the caller.
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

  constructor(private readonly prisma: PrismaService) {}

  async interceptAndExecute(req: AgentRequest): Promise<ProxyOutcome> {
    const { method, path, source, headers, tenantId, organizationId } = req;
    if (!organizationId) {
      throw new HttpException(
        { allowed: false, status: 'BLOCKED', reason: 'Missing organization context' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    this.logger.log(`Intercepting [${method}] ${path} from ${source} (org=${organizationId})`);

    const startTime = process.hrtime();

    const activeRules = await this.prisma.policyRule.findMany({
      where: { organizationId, isActive: true },
    });

    for (const rule of activeRules) {
      const methodMatches =
        rule.targetMethod === '*' || rule.targetMethod.toUpperCase() === method.toUpperCase();
      const pathMatches = rule.targetPath === '*' || path.includes(rule.targetPath);

      if (source === 'external_mcp' && methodMatches && pathMatches) {
        switch (rule.ruleType) {
          case 'AUDIT':
            if (!headers || !headers['x-agent-reasoning']) {
              this.logger.warn(`Blocked by Rule [${rule.name}] - Missing Audit Context`);
              throw new HttpException(
                { allowed: false, status: 'BLOCKED', reason: `Policy Violation: ${rule.description}` },
                HttpStatus.FORBIDDEN,
              );
            }
            break;

          case 'MUTATION_APPROVAL': {
            this.logger.warn(`Intercepted by Rule [${rule.name}] - Triggering Approval`);
            const config = rule.actionConfig as any;
            this.dispatchApprovalWebhook(config?.channel || '#ops', req);
            return {
              kind: 'policy',
              allowed: false,
              status: 'AWAITING_APPROVAL',
              reason: `Policy Engine intercepted execution: ${rule.description}`,
            };
          }

          case 'RATE_LIMIT':
            if (!tenantId) {
              this.logger.error(`Blocked by Rule [${rule.name}] - Missing Tenant Isolation`);
              throw new HttpException(
                { allowed: false, status: 'BLOCKED', reason: `Policy Violation: ${rule.description}` },
                HttpStatus.FORBIDDEN,
              );
            }
            break;
        }
      }
    }

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
        // Accept any status so we can forward 4xx/5xx faithfully instead of throwing.
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

  private dispatchApprovalWebhook(channel: string, req: AgentRequest) {
    this.logger.log(
      `[WEBHOOK] Sending interactive approval card to Slack ${channel} for Agent requesting ${req.path}`,
    );
  }
}

export function joinUrl(base: string, path: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}
