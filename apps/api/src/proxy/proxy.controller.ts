import {
  Controller,
  Post,
  Body,
  Headers,
  Get,
  Patch,
  Param,
  NotFoundException,
  Res,
  HttpException,
  HttpStatus,
  Logger,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import type { Response } from 'express';
import { Transform } from 'stream';
import { ProxyService, AgentRequest } from './proxy.service';
import { PrismaService } from '../prisma.service';
import { CurrentOrg, AuthContext } from '../auth/current-org.decorator';
import { AuditService } from '../audit/audit.service';
import { AgentService } from '../agents/agent.service';

@Controller('proxy')
export class ProxyController {
  private readonly logger = new Logger(ProxyController.name);

  constructor(
    private readonly proxyService: ProxyService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly agentService: AgentService,
  ) {}

  @Post('execute')
  async executeAgentAction(
    @CurrentOrg() org: AuthContext,
    @Body() body: any,
    @Headers() allHeaders: Record<string, string>,
    @Res() res: Response,
  ) {
    const startedAt = Date.now();
    const requestBytes = body ? Buffer.byteLength(JSON.stringify(body)) : 0;
    const reasoning = allHeaders['x-agent-reasoning'] || null;
    const tenantId = allHeaders['x-tenant-id'] || null;
    const headerSource = allHeaders['x-agent-source'] as 'internal_mcp' | 'external_mcp' | undefined;
    const agentIdHeader = allHeaders['x-agent-id'] || null;

    if (!agentIdHeader) {
      throw new UnauthorizedException('Missing x-agent-id header');
    }

    const agent = await this.agentService.resolve(org.organizationId, agentIdHeader);
    if (!agent) {
      // Audited as a system-level block — no agent attribution since none was resolvable.
      this.audit.recordSafe({
        organizationId: org.organizationId,
        apiKeyId: org.apiKeyId,
        method: body?.method || 'GET',
        path: body?.path || '',
        source: headerSource ?? 'external_mcp',
        tenantId,
        reasoning,
        reason: `Unknown agent id: ${agentIdHeader}`,
        actionTaken: 'BLOCKED',
        upstreamStatus: null,
        requestBytes,
        responseBytes: null,
        latencyMs: Date.now() - startedAt,
      });
      throw new UnauthorizedException('Unknown agent id');
    }
    if (!agent.enabled || agent.revokedAt) {
      this.audit.recordSafe({
        organizationId: org.organizationId,
        apiKeyId: org.apiKeyId,
        agentId: agent.id,
        method: body?.method || 'GET',
        path: body?.path || '',
        source: agent.source as 'internal_mcp' | 'external_mcp',
        tenantId,
        reasoning,
        reason: agent.revokedAt ? 'Agent revoked' : 'Agent disabled',
        actionTaken: 'BLOCKED',
        upstreamStatus: null,
        requestBytes,
        responseBytes: null,
        latencyMs: Date.now() - startedAt,
      });
      throw new ForbiddenException(agent.revokedAt ? 'Agent revoked' : 'Agent disabled');
    }
    if (headerSource && headerSource !== agent.source) {
      throw new ForbiddenException(
        `x-agent-source (${headerSource}) does not match agent.source (${agent.source})`,
      );
    }
    if (agent.tenantScope && tenantId !== agent.tenantScope) {
      throw new ForbiddenException(
        `Agent is scoped to tenant ${agent.tenantScope}; x-tenant-id mismatch`,
      );
    }

    const source = agent.source as 'internal_mcp' | 'external_mcp';
    const req: AgentRequest = {
      method: body.method || 'GET',
      path: body.path,
      source,
      tenantId: tenantId ?? undefined,
      headers: allHeaders,
      query: body.query,
      body: body.payload,
      organizationId: org.organizationId,
    };

    let outcome;
    try {
      outcome = await this.proxyService.interceptAndExecute(req);
    } catch (e) {
      const status = e instanceof HttpException ? e.getStatus() : 500;
      const reason =
        e instanceof HttpException
          ? ((e.getResponse() as any)?.reason ?? e.message)
          : (e as Error).message;
      this.audit.recordSafe({
        organizationId: org.organizationId,
        apiKeyId: org.apiKeyId,
        agentId: agent.id,
        method: req.method,
        path: req.path,
        source: req.source,
        tenantId,
        reasoning,
        reason,
        actionTaken: 'BLOCKED',
        upstreamStatus:
          status === HttpStatus.BAD_GATEWAY || status === HttpStatus.GATEWAY_TIMEOUT ? status : null,
        requestBytes,
        responseBytes: null,
        latencyMs: Date.now() - startedAt,
      });
      throw e;
    }

    if (outcome.kind === 'policy') {
      this.audit.recordSafe({
        organizationId: org.organizationId,
        apiKeyId: org.apiKeyId,
        agentId: agent.id,
        method: req.method,
        path: req.path,
        source: req.source,
        tenantId,
        reasoning,
        reason: outcome.reason,
        actionTaken: outcome.status,
        upstreamStatus: null,
        requestBytes,
        responseBytes: null,
        latencyMs: Date.now() - startedAt,
      });
      res.status(202).json({
        allowed: false,
        status: outcome.status,
        reason: outcome.reason,
      });
      return;
    }

    let responseBytes = 0;
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        responseBytes += chunk.length;
        cb(null, chunk);
      },
    });

    res.status(outcome.status);
    for (const [k, v] of Object.entries(outcome.headers)) {
      res.setHeader(k, v);
    }

    let recorded = false;
    const finalize = (action: 'EXECUTED' | 'INCOMPLETE') => {
      if (recorded) return;
      recorded = true;
      this.audit.recordSafe({
        organizationId: org.organizationId,
        apiKeyId: org.apiKeyId,
        agentId: agent.id,
        method: req.method,
        path: req.path,
        source: req.source,
        tenantId,
        reasoning,
        reason: action === 'INCOMPLETE' ? 'client disconnected before stream finished' : null,
        actionTaken: action,
        upstreamStatus: outcome.status,
        requestBytes,
        responseBytes,
        latencyMs: Date.now() - startedAt,
      });
    };

    res.on('finish', () => finalize('EXECUTED'));
    res.on('close', () => finalize('INCOMPLETE'));

    outcome.stream.on('error', (err) => {
      this.logger.error(`upstream stream error: ${err.message}`);
      if (!res.headersSent) res.status(502);
      res.end();
    });

    outcome.stream.pipe(counter).pipe(res);
  }

  @Get('policies')
  getPolicies(@CurrentOrg() org: AuthContext) {
    return this.prisma.policyRule.findMany({
      where: { organizationId: org.organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Patch('policies/:id')
  async togglePolicy(
    @CurrentOrg() org: AuthContext,
    @Param('id') id: string,
    @Body('isActive') isActive: boolean,
  ) {
    const existing = await this.prisma.policyRule.findFirst({
      where: { id, organizationId: org.organizationId },
    });
    if (!existing) throw new NotFoundException();
    return this.prisma.policyRule.update({ where: { id }, data: { isActive } });
  }
}
