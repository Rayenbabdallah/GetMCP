import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CurrentOrg, AuthContext } from '../auth/current-org.decorator';
import { AgentService } from './agent.service';
import { CreateAgentDto, UpdateAgentDto } from './agent.dto';

@Controller('agents')
export class AgentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agents: AgentService,
  ) {}

  @Get()
  list(@CurrentOrg() ctx: AuthContext) {
    return this.prisma.agentIdentity.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post()
  async create(@CurrentOrg() ctx: AuthContext, @Body() body: CreateAgentDto) {
    return this.prisma.agentIdentity.create({
      data: {
        organizationId: ctx.organizationId,
        name: body.name.trim(),
        source: body.source,
        tenantScope: body.tenantScope ?? null,
        enabled: body.enabled ?? true,
      },
    });
  }

  @Patch(':id')
  async update(
    @CurrentOrg() ctx: AuthContext,
    @Param('id') id: string,
    @Body() body: UpdateAgentDto,
  ) {
    const existing = await this.prisma.agentIdentity.findFirst({
      where: { id, organizationId: ctx.organizationId },
    });
    if (!existing) throw new NotFoundException();

    const data: Record<string, any> = {};
    if (body.name !== undefined) data.name = body.name.trim();
    if (body.tenantScope !== undefined) data.tenantScope = body.tenantScope;
    if (body.enabled !== undefined) data.enabled = body.enabled;

    const updated = await this.prisma.agentIdentity.update({ where: { id }, data });
    this.agents.invalidate(ctx.organizationId, id);
    return updated;
  }

  @Delete(':id')
  async revoke(@CurrentOrg() ctx: AuthContext, @Param('id') id: string) {
    const existing = await this.prisma.agentIdentity.findFirst({
      where: { id, organizationId: ctx.organizationId },
    });
    if (!existing) throw new NotFoundException();
    const updated = await this.prisma.agentIdentity.update({
      where: { id },
      data: { revokedAt: new Date(), enabled: false },
    });
    this.agents.invalidate(ctx.organizationId, id);
    return updated;
  }
}
