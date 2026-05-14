import { Controller, Post, Body, Headers, Get, Patch, Param, NotFoundException } from '@nestjs/common';
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
    @Headers('x-agent-source') sourceHeader: string,
    @Headers('x-agent-reasoning') reasoningHeader: string,
    @Headers('x-tenant-id') tenantHeader: string,
  ) {
    const req: AgentRequest = {
      method: body.method || 'GET',
      path: body.path,
      source: (sourceHeader as 'internal_mcp' | 'external_mcp') || 'external_mcp',
      tenantId: tenantHeader,
      headers: { 'x-agent-reasoning': reasoningHeader },
      body: body.payload,
      organizationId: org.organizationId,
    };
    return this.proxyService.interceptAndExecute(req);
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
