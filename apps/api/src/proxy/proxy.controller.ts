import { Controller, Post, Body, Headers, Get, Patch, Param } from '@nestjs/common';
import { ProxyService, AgentRequest } from './proxy.service';
import { PrismaService } from '../prisma.service';

@Controller('proxy')
export class ProxyController {
  constructor(
    private readonly proxyService: ProxyService,
    private readonly prisma: PrismaService
  ) {}

  @Post('execute')
  async executeAgentAction(
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
      headers: {
        'x-agent-reasoning': reasoningHeader
      },
      body: body.payload
    };

    return await this.proxyService.interceptAndExecute(req);
  }

  @Get('policies')
  async getPolicies() {
    return this.prisma.policyRule.findMany({
      orderBy: { createdAt: 'desc' }
    });
  }

  @Patch('policies/:id')
  async togglePolicy(@Param('id') id: string, @Body('isActive') isActive: boolean) {
    return this.prisma.policyRule.update({
      where: { id },
      data: { isActive }
    });
  }
}
