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
import { PolicyService } from './policy.service';
import { EvalContext } from './policy.engine';
import { CreatePolicyDto, UpdatePolicyDto, SimulateDto } from './policy.dto';

@Controller('policies')
export class PolicyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  @Get()
  list(@CurrentOrg() org: AuthContext) {
    return this.prisma.policyRule.findMany({
      where: { organizationId: org.organizationId },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
  }

  @Post()
  async create(@CurrentOrg() org: AuthContext, @Body() body: CreatePolicyDto) {
    const created = await this.prisma.policyRule.create({
      data: {
        organizationId: org.organizationId,
        name: body.name.trim(),
        description: body.description ?? '',
        ruleType: body.ruleType,
        targetMethod: body.targetMethod,
        targetPath: body.targetPath,
        action: body.action ?? body.ruleType,
        actionConfig: body.actionConfig ?? {},
        priority: body.priority ?? 100,
        isActive: body.isActive ?? true,
      },
    });
    this.policy.invalidate(org.organizationId);
    return created;
  }

  @Patch(':id')
  async update(
    @CurrentOrg() org: AuthContext,
    @Param('id') id: string,
    @Body() body: UpdatePolicyDto,
  ) {
    const existing = await this.prisma.policyRule.findFirst({
      where: { id, organizationId: org.organizationId },
    });
    if (!existing) throw new NotFoundException();

    const data: Record<string, any> = {};
    for (const k of ['name', 'description', 'targetMethod', 'targetPath', 'action', 'actionConfig', 'priority', 'isActive'] as const) {
      if (body[k] !== undefined) data[k] = body[k];
    }
    const updated = await this.prisma.policyRule.update({ where: { id }, data });
    this.policy.invalidate(org.organizationId);
    return updated;
  }

  @Delete(':id')
  async remove(@CurrentOrg() org: AuthContext, @Param('id') id: string) {
    const existing = await this.prisma.policyRule.findFirst({
      where: { id, organizationId: org.organizationId },
    });
    if (!existing) throw new NotFoundException();
    await this.prisma.policyRule.delete({ where: { id } });
    this.policy.invalidate(org.organizationId);
    return { id };
  }

  // Dry-run: evaluate the request shape against active rules without forwarding
  // upstream and without consuming rate-limit tokens? We DO consume tokens here
  // because doing otherwise would let callers dry-run their way around limits.
  // Document this in the response so the caller knows.
  @Post('simulate')
  async simulate(@CurrentOrg() org: AuthContext, @Body() body: SimulateDto) {
    const ctx: EvalContext = {
      organizationId: org.organizationId,
      method: body.method,
      path: body.path,
      source: body.source,
      agentId: body.agentId ?? null,
      tenantId: body.tenantId ?? null,
      reasoning: body.reasoning ?? null,
    };
    const decision = await this.policy.evaluate(ctx);
    return {
      decision: decision.kind,
      ...(decision.kind === 'block' || decision.kind === 'awaiting_approval'
        ? { rule: decision.rule, reason: (decision as any).reason }
        : {}),
      ...(decision.kind === 'rate_limited'
        ? { rule: decision.rule, retryAfterMs: decision.retryAfterMs }
        : {}),
      ...(decision.kind === 'awaiting_approval' ? { channel: decision.channel } : {}),
      trace: decision.trace,
      note: 'simulate consumes rate-limit tokens',
    };
  }
}
