import { Controller, Post, Body, Headers } from '@nestjs/common';
import { ProxyService, AgentRequest } from './proxy.service';

@Controller('proxy')
export class ProxyController {
  constructor(private readonly proxyService: ProxyService) {}

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
}
