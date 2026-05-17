import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApprovalService } from './approval.service';
import { CurrentOrg, AuthContext } from '../auth/current-org.decorator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('Approvals')
@ApiBearerAuth('org-api-key')
@Controller('approvals')
export class ApprovalController {
  constructor(private readonly approvals: ApprovalService) {}

  // Paginated list of held requests. Filter by status (PENDING / APPROVED /
  // DENIED / EXPIRED). Each row includes a _count of recorded approval votes.
  @Get()
  async list(
    @CurrentOrg() org: AuthContext,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.approvals.list(org.organizationId, {
      status: status || undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      cursor: cursor || undefined,
    });
  }

  // Per-approver health stats for the dashboard. Surfaces patterns (e.g. high
  // auto-approval rate) without attaching blame to individuals — designed for
  // coaching, not PIPs. See docs/security.md "blame vs coach" stance.
  @Get('stats')
  async stats(@CurrentOrg() org: AuthContext, @Query('windowDays') windowDays?: string) {
    const days = windowDays ? parseInt(windowDays, 10) : 30;
    return this.approvals.approverStats(org.organizationId, days);
  }

  // Caller of /proxy/execute polls this endpoint until status leaves PENDING.
  // When status === 'APPROVED', responseStatus / responseHeaders / responseBody
  // contain the captured upstream response. Includes the per-vote approval log
  // so the UI can render quorum progress and per-approver justifications.
  @Get(':id')
  async get(@CurrentOrg() org: AuthContext, @Param('id') id: string) {
    return this.approvals.getById(org.organizationId, id);
  }
}
