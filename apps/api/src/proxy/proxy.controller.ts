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
} from '@nestjs/common';
import type { Response } from 'express';
import { ProxyService, AgentRequest } from './proxy.service';
import { PrismaService } from '../prisma.service';
import { CurrentOrg, AuthContext } from '../auth/current-org.decorator';

@Controller('proxy')
export class ProxyController {
  constructor(
    private readonly proxyService: ProxyService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('execute')
  async executeAgentAction(
    @CurrentOrg() org: AuthContext,
    @Body() body: any,
    @Headers() allHeaders: Record<string, string>,
    @Res() res: Response,
  ) {
    const req: AgentRequest = {
      method: body.method || 'GET',
      path: body.path,
      source: (allHeaders['x-agent-source'] as 'internal_mcp' | 'external_mcp') || 'external_mcp',
      tenantId: allHeaders['x-tenant-id'],
      headers: allHeaders,
      query: body.query,
      body: body.payload,
      organizationId: org.organizationId,
    };

    const outcome = await this.proxyService.interceptAndExecute(req);

    if (outcome.kind === 'policy') {
      // Approval / soft block — JSON response, 202 to signal "not yet executed".
      res.status(202).json({
        allowed: false,
        status: outcome.status,
        reason: outcome.reason,
      });
      return;
    }

    // Faithful pass-through of the upstream response.
    res.status(outcome.status);
    for (const [k, v] of Object.entries(outcome.headers)) {
      res.setHeader(k, v);
    }
    outcome.stream.pipe(res);
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
