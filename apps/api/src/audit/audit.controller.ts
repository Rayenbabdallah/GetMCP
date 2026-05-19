import { Controller, Get, Query, Res, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma.service';
import { CurrentOrg, AuthContext } from '../auth/current-org.decorator';
import { AuditService } from './audit.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('Audit')
@ApiBearerAuth('org-api-key')
@Controller('audit')
export class AuditController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentOrg() ctx: AuthContext,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('path') path?: string,
    @Query('agentId') agentId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitStr?: string,
  ) {
    const limit = Math.min(Math.max(parseInt(limitStr || '100', 10) || 100, 1), 1000);

    const where: any = { organizationId: ctx.organizationId };
    if (from) {
      const d = new Date(from);
      if (Number.isNaN(d.getTime())) throw new BadRequestException('invalid `from`');
      where.timestamp = { ...(where.timestamp || {}), gte: d };
    }
    if (to) {
      const d = new Date(to);
      if (Number.isNaN(d.getTime())) throw new BadRequestException('invalid `to`');
      where.timestamp = { ...(where.timestamp || {}), lte: d };
    }
    if (path) where.path = { contains: path };
    if (agentId) where.agentId = agentId;

    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { seq: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      data: page,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  @Get('verify')
  verify(@CurrentOrg() ctx: AuthContext) {
    return this.audit.verifyChain(ctx.organizationId);
  }

  // Lean payload of scored requests for the dashboard chart. Only returns rows
  // where a BEHAVIORAL_ANOMALY rule was active (anomalyScore is not null).
  // Default window: last 24h. Capped at 500 rows.
  @Get('anomalies')
  async anomalies(
    @CurrentOrg() ctx: AuthContext,
    @Query('windowHours') windowHoursStr?: string,
    @Query('limit') limitStr?: string,
  ) {
    const windowHours = Math.min(Math.max(parseInt(windowHoursStr || '24', 10) || 24, 1), 168);
    const limit = Math.min(Math.max(parseInt(limitStr || '500', 10) || 500, 1), 2000);
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

    const rows = await this.prisma.auditLog.findMany({
      where: {
        organizationId: ctx.organizationId,
        anomalyScore: { not: null },
        timestamp: { gte: since },
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
      select: {
        id: true,
        timestamp: true,
        agentId: true,
        method: true,
        path: true,
        actionTaken: true,
        anomalyScore: true,
      },
    });

    return { windowHours, count: rows.length, data: rows };
  }

  @Get('export')
  async export(@CurrentOrg() ctx: AuthContext, @Res() res: Response) {
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Content-Disposition', 'attachment; filename="audit.ndjson"');

    const PAGE = 500;
    let cursor: string | undefined;
    while (true) {
      const rows = await this.prisma.auditLog.findMany({
        where: { organizationId: ctx.organizationId },
        orderBy: { seq: 'asc' },
        take: PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        res.write(JSON.stringify(row) + '\n');
      }
      cursor = rows[rows.length - 1].id;
      if (rows.length < PAGE) break;
    }
    res.end();
  }
}
